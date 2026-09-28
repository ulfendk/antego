import {
  BOARDS,
  legalTargets,
  side,
  pieceAt,
  presetPlacement,
  randomPlacement,
  randomSeed,
  samePos,
  type Difficulty,
  type GameEvent,
  type MinigameMode,
  type GameView,
  type Placement,
  type Pos,
  type PresetId,
  type Rank,
  type Team,
} from '@antego/shared';
import { renderSVG } from 'uqr';
import { LocalController, type Controller } from './game/controller.js';
import { OnlineController, OnlineError } from './net/online.js';
import { TutorialController } from './game/tutorial.js';
import { Tutorial } from './ui/tutorial.js';
import { runMinigame } from './minigames/runner.js';
import type { LineId } from './generated/lines.js';
import { updater } from './pwa/updater.js';
import type { PieceKit } from './scene/pieces.js';
import type { World } from './scene/world.js';
import type { Presenter, BattleInfo } from './scene/presenter.js';
import { saveQuality, type Quality } from './scene/quality.js';
import type { Stage } from './scene/stage.js';
import { button, h, line, t } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { insignia, rankLabel } from './ui/insignia.js';
import { voice } from './voice/voice.js';
import { sfx } from './audio/sfx.js';
import { RaceLauncher } from './race/launcher.js';
import { runRace } from './race/race.js';
import { VehicleKit } from './scene/vehicles.js';
import { Water } from './scene/water.js';

const rankLine = (r: Rank) => `rang.${r}` as LineId;
/** Per-army text, e.g. teamLine('spil.tur', 'blaa') → 'spil.tur_blaa'. */
const teamLine = (prefix: string, team: Team) => `${prefix}_${team}` as LineId;
const rankInfo = (r: Rank) => `rang.${r}_info` as LineId;

interface SetupState {
  team: Team;
  placement: Placement[];
  pick: number | null;
}

export class App {
  private controller: Controller | null = null;
  private opponentHere = false;
  private tutorial: Tutorial | null = null;
  private view: GameView | null = null;
  private setupState: SetupState | null = null;
  private selected: string | null = null;
  private animating = false;
  private handingOver = false;
  private screen = h('div', { class: 'screen-layer' });
  private hud = h('div', { class: 'hud-layer' });
  private banner = h('div', { class: 'banner-layer' });

  constructor(
    private root: HTMLElement,
    private stage: Stage,
    private presenter: Presenter,
    private kit: PieceKit,
    private world: World,
  ) {
    root.append(this.hud, this.banner, this.screen);
    this.bindInput();
    this.launcher = new RaceLauncher(stage.scene, stage);
    // The vehicles aren't needed straight away: let the soldiers load first.
    setTimeout(
      () =>
        void VehicleKit.load()
          .then((k) => this.launcher.attach(k))
          .catch(() => undefined),
      4000,
    );
  }

  private launcher: RaceLauncher;
  private racing = false;
  private raceWater: Water | null = null;

  // ---------------------------------------------------------------- screens

  private show(...children: (Node | null)[]) {
    this.screen.replaceChildren(...children.filter((c): c is Node => !!c));
    // The race jeep waits in its toy box whenever we're between games.
    this.launcher.show(!this.controller && !this.racing);
  }

  /** The tabletop race (tap the jeep in the toy box on the welcome screen). */
  private async startRace() {
    if (this.racing) return;
    this.racing = true;
    this.launcher.show(false);
    this.stage.idleOrbit(false);
    updater.setSafe(false);
    try {
      const vehicles = await VehicleKit.load();
      this.raceWater ??= new Water(this.stage.scene);
      const ctx = {
        stage: this.stage,
        layer: this.screen,
        kit: this.kit,
        vehicles,
        water: this.raceWater,
      };
      while ((await runRace(ctx)) === 'again');
    } finally {
      this.racing = false;
      updater.setSafe(true);
      this.menu();
    }
  }

  menu() {
    this.leaveGame();
    this.world.use('klassisk');
    this.show(
      h(
        'div',
        { class: 'panel menu' },
        h('img', { class: 'logo', src: '/logo.svg', alt: '' }),
        line('menu.titel', 'h1', 'title'),
        button('menu.spil_computer', () => this.chooseDifficulty(), 'big', '🤖'),
        button('menu.spil_to', () => this.choosePlayers('hotseat'), 'big', '👫'),
        button('menu.spil_online', () => this.onlineMenu(), 'big', '🌍'),
        button('menu.tutorial', () => this.startTutorial(), 'small', '📖'),
        button('menu.indstillinger', () => this.settings(), 'small', '⚙️'),
      ),
    );
    // Frame the toy box so the race jeep sits in the strip below the card.
    const card = this.screen.querySelector('.panel.menu')?.getBoundingClientRect();
    const bottom = card ? 1 - (2 * card.bottom) / innerHeight : -0.74;
    void this.stage.welcome(Math.max(-0.9, Math.min(0.2, bottom)));
  }

  private chooseDifficulty() {
    const pick = (d: Difficulty) => this.choosePlayers('ai', d);
    this.show(
      h(
        'div',
        { class: 'panel' },
        line('menu.svaerhed', 'h2'),
        h(
          'div',
          { class: 'row' },
          button('menu.let', () => pick('let'), 'big', '⭐'),
          button('menu.mellem', () => pick('mellem'), 'big', '⭐⭐'),
          button('menu.svaer', () => pick('svaer'), 'big', '⭐⭐⭐'),
        ),
        button('menu.tilbage', () => this.menu(), 'small', '↩'),
      ),
    );
  }

  /** Two armies play classic Stratego; three or four play on the plus-shaped board. */
  private choosePlayers(mode: 'ai' | 'hotseat', difficulty: Difficulty = 'mellem') {
    const pick = (n: 2 | 3 | 4) =>
      n === 4 ? this.chooseTeams(mode, difficulty) : this.chooseMinigames(mode, difficulty, n);
    this.show(
      h(
        'div',
        { class: 'panel' },
        line('menu.antal', 'h2'),
        h(
          'div',
          { class: 'col' },
          button('menu.to_haere', () => pick(2), 'big', '🟩🟫'),
          button('menu.tre_haere', () => pick(3), 'big', '🟩🟦🟫'),
          button('menu.fire_haere', () => pick(4), 'big', '🟩🟦🟫🟤'),
        ),
        button('menu.tilbage', () => this.menu(), 'small', '↩'),
      ),
    );
  }

  /** Four armies: everyone for themselves, or two against two (partners sit opposite). */
  private chooseTeams(mode: 'ai' | 'hotseat', difficulty: Difficulty) {
    this.show(
      h(
        'div',
        { class: 'panel' },
        line('menu.hold_spoerg', 'h2'),
        h(
          'div',
          { class: 'col' },
          button(
            'menu.alle_mod_alle',
            () => this.chooseMinigames(mode, difficulty, 4, false),
            'big',
            '⚔️',
          ),
          button(
            'menu.to_mod_to',
            () => this.chooseMinigames(mode, difficulty, 4, true),
            'big',
            '🤝',
          ),
        ),
        button('menu.tilbage', () => this.menu(), 'small', '↩'),
      ),
    );
  }

  private chooseMinigames(
    mode: 'ai' | 'hotseat' | 'online',
    difficulty: Difficulty = 'mellem',
    players: 2 | 3 | 4 = 2,
    hold = false,
  ) {
    const current = savedMinigames();
    const pick = (m: MinigameMode) => {
      saveMinigames(m);
      if (mode === 'online') void this.createOnline(m);
      else this.newGame(mode, difficulty, m, players, hold);
    };
    const opt = (m: MinigameMode, id: LineId, icon: string) =>
      button(id, () => pick(m), current === m ? 'big on' : 'big', icon);
    this.show(
      h(
        'div',
        { class: 'panel' },
        line('menu.minispil', 'h2'),
        h(
          'div',
          { class: 'col' },
          opt('lige', 'menu.minispil_ja', '🎮'),
          opt('aldrig', 'menu.minispil_nej', '♟️'),
        ),
        button('menu.tilbage', () => this.menu(), 'small', '↩'),
      ),
    );
  }

  private settings() {
    const set = (q: Quality) => {
      saveQuality(q);
      location.reload();
    };
    this.show(
      h(
        'div',
        { class: 'panel' },
        line('menu.grafik', 'h2'),
        h(
          'div',
          { class: 'row' },
          button(
            'menu.grafik_hoej',
            () => set('hoej'),
            this.stage.quality === 'hoej' ? 'big on' : 'big',
          ),
          button(
            'menu.grafik_mellem',
            () => set('mellem'),
            this.stage.quality === 'mellem' ? 'big on' : 'big',
          ),
          button(
            'menu.grafik_lav',
            () => set('lav'),
            this.stage.quality === 'lav' ? 'big on' : 'big',
          ),
        ),
        line('menu.lyd', 'h2'),
        h(
          'div',
          { class: 'row' },
          button(
            'menu.til',
            () => (voice.setEnabled(true), this.settings()),
            voice.enabled ? 'big on' : 'big',
            '🔊',
          ),
          button(
            'menu.fra',
            () => (voice.setEnabled(false), this.settings()),
            voice.enabled ? 'big' : 'big on',
            '🔇',
          ),
        ),
        line('menu.lydeffekter', 'h2'),
        h(
          'div',
          { class: 'row' },
          button(
            'menu.til',
            () => (sfx.setEnabled(true), this.settings()),
            sfx.enabled ? 'big on' : 'big',
            '🔊',
          ),
          button(
            'menu.fra',
            () => (sfx.setEnabled(false), this.settings()),
            sfx.enabled ? 'big' : 'big on',
            '🔇',
          ),
        ),
        button('menu.tilbage', () => this.menu(), 'small', '↩'),
        h('p', { class: 'version' }, `v${__APP_VERSION__}`),
      ),
    );
  }

  // ---------------------------------------------------------------- game flow

  private newGame(
    mode: 'ai' | 'hotseat',
    difficulty: Difficulty = 'mellem',
    minigames: MinigameMode = savedMinigames(),
    players: 2 | 3 | 4 = 2,
    hold = false,
  ) {
    this.controller?.dispose();
    this.presenter.reset();
    this.handingOver = false;
    this.inMinigame = false;
    this.banner.replaceChildren();
    this.lastGame = { mode, difficulty, minigames, players, hold };
    this.world.use(players > 2 ? 'kryds' : 'klassisk');
    const c = new LocalController(mode, { minigames }, difficulty, players, hold);
    this.controller = c;
    this.view = null;
    this.selected = null;
    c.subscribe((view, events) => this.onView(view, events));
    this.startSetup('groen');
  }

  private startSetup(team: Team) {
    const c = this.controller!;
    updater.setSafe(true);
    c.setViewer(team);
    const board = BOARDS[c.view().board];
    this.setupState = { team, placement: presetPlacement(team, 'forsvar', board), pick: null };
    void this.stage.setSide(team);
    this.renderSetup();
    const preset = (id: PresetId) => {
      this.setupState!.placement = presetPlacement(team, id, board);
      this.setupState!.pick = null;
      this.renderSetup();
    };
    this.hud.replaceChildren();
    this.show(
      h(
        'div',
        { class: 'setup-bar' },
        line('opstilling.titel', 'h2'),
        line('opstilling.hjaelp', 'p', 'hint'),
        h(
          'div',
          { class: 'row' },
          button('opstilling.forsvar', () => preset('forsvar'), '', '🛡️'),
          button('opstilling.angreb', () => preset('angreb'), '', '⚔️'),
          button('opstilling.snigende', () => preset('snigende'), '', '🌿'),
          button(
            'opstilling.bland',
            () => {
              this.setupState!.placement = randomPlacement(team, randomSeed(), board);
              this.setupState!.pick = null;
              this.renderSetup();
            },
            '',
            '🎲',
          ),
        ),
        button('opstilling.klar', () => this.finishSetup(), 'big go', '✔'),
      ),
    );
  }

  /** Shows the setup being edited: our pieces from the draft placement, plus the enemy if already placed. */
  private renderSetup() {
    const c = this.controller!;
    const s = this.setupState!;
    const base = c.view();
    const draft = s.placement.map((p, i) => ({
      id: `${s.team}-${i}`,
      team: s.team,
      rank: p.rank,
      x: p.x,
      y: p.y,
      revealed: false,
      moved: false,
    }));
    this.presenter.sync({
      ...base,
      viewer: s.team,
      pieces: [...base.pieces.filter((p) => p.team !== s.team), ...draft],
    });
    this.presenter.select(s.pick === null ? null : `${s.team}-${s.pick}`, []);
  }

  private setupTap(sq: Pos) {
    const s = this.setupState!;
    const idx = s.placement.findIndex((p) => samePos(p, sq));
    if (idx < 0) return;
    if (s.pick === null) {
      s.pick = idx;
      const r = s.placement[idx]!.rank;
      toast([rankLine(r), rankInfo(r)], 2500, insignia(r));
    } else if (s.pick === idx) {
      s.pick = null;
    } else {
      const a = s.placement[s.pick]!;
      const b = s.placement[idx]!;
      [a.rank, b.rank] = [b.rank, a.rank];
      s.pick = null;
    }
    this.renderSetup();
  }

  private finishSetup() {
    const c = this.controller!;
    const s = this.setupState!;
    this.setupState = null;
    this.presenter.select(null, []);
    this.show();
    c.setup(s.team, s.placement);
    const v = c.view();
    const next = v.teams.find((t) => !v.placed[t]);
    if (c.mode === 'hotseat' && next) {
      this.handover(next, () => this.startSetup(next));
    } else if (c.mode === 'online' && this.view?.phase === 'setup') {
      this.show(h('div', { class: 'panel' }, line('online.venter_opstilling', 'h2')));
    }
  }

  private onView(view: GameView, events: GameEvent[]) {
    this.view = view;
    if (this.controller?.mode === 'online' && view.phase === 'setup') {
      this.onlineSetupStep();
      return;
    }
    // During setup the draft on screen wins; the hand-over screen re-presents explicitly.
    if (this.setupState || view.phase === 'setup') return;
    this.animating = true;
    void this.presenter.present(view, events).then(() => {
      this.animating = false;
      this.afterPresent(view, events);
    });
  }

  private afterPresent(view: GameView, events: GameEvent[]) {
    const c = this.controller;
    if (!c || view !== this.view) return;
    if (c.mode === 'tutorial') {
      this.tutorial?.onPresented(view, events);
      return;
    }
    if (view.phase === 'over') {
      this.gameOver(view);
      return;
    }
    if (view.phase === 'battle') {
      void this.playBattle(view);
      return;
    }
    if (view.phase !== 'play') return;
    updater.setSafe(false);
    const me = c.me(view);
    if (c.mode === 'ai' && view.hold && events.some((e) => e.type === 'started')) {
      toast('spil.makker', 4500);
    }
    if (c.mode === 'ai' && me && events.some((e) => e.type === 'out' && e.team === me)) {
      this.show(
        h(
          'div',
          { class: 'panel' },
          line('spil.du_er_ude', 'h2'),
          button('spil.se_med', () => this.show(), 'big go', '👀'),
          button('slut.menu', () => this.menu(), '', '🏠'),
        ),
      );
    }
    if (c.mode === 'online' && !this.inMinigame) this.show();
    const turnEvent = events.find((e) => e.type === 'turn');
    if (c.mode === 'hotseat' && turnEvent && !this.handingOver) {
      this.handover(view.turn, () => this.showTurn());
      return;
    }
    this.showTurn();
  }

  /** Hot-seat: hide every rank, swing the board round and wait for the other army. */
  private handover(team: Team, then: () => void) {
    const c = this.controller!;
    this.handingOver = true;
    c.setViewer(null);
    void this.presenter.present(c.view(), []);
    void this.stage.setSide(team);
    this.hud.replaceChildren();
    this.show(
      h(
        'div',
        { class: `panel handover ${team}` },
        line(teamLine('spil.giv', team), 'h2'),
        button(
          'spil.jeg_er_klar',
          () => {
            this.handingOver = false;
            this.show();
            c.setViewer(team);
            this.view = c.view();
            void this.presenter.present(this.view, []);
            then();
          },
          'big go',
          '👀',
        ),
      ),
    );
  }

  private showTurn() {
    const c = this.controller!;
    const view = this.view!;
    const mine = view.turn === c.me(view);
    const id: LineId =
      c.mode === 'hotseat'
        ? teamLine('spil.tur', view.turn)
        : mine
          ? 'spil.din_tur'
          : c.mode === 'ai'
            ? 'spil.computer_tur'
            : 'online.modstander_tur';
    const bar =
      view.teams.length > 2
        ? h(
            'div',
            { class: 'turnbar', 'aria-hidden': 'true' },
            ...view.teams.map((t) =>
              h('span', {
                class: `chip ${t}${t === view.turn ? ' now' : ''}${view.out.includes(t) ? ' out' : ''}`,
              }),
            ),
          )
        : null;
    this.hud.replaceChildren(
      h('div', { class: 'turn-wrap' }, h('div', { class: `turn ${view.turn}` }, line(id)), bar),
      h(
        'div',
        { class: 'hud-buttons' },
        h(
          'button',
          {
            class: 'btn icon-only',
            'data-line': 'spil.centrer',
            'aria-label': t('spil.centrer'),
            onclick: () => void this.stage.setSide(this.stage.currentSide),
          },
          '⌖',
        ),
        h(
          'button',
          {
            class: 'btn icon-only menu-btn',
            'aria-label': t('spil.menu'),
            onclick: () => this.pause(),
          },
          '☰',
        ),
      ),
    );
  }

  private pause() {
    const c = this.controller;
    if (!c) return;
    const me: Team = (this.view && c.me(this.view)) ?? 'groen';
    this.show(
      h(
        'div',
        { class: 'panel' },
        button('spil.fortsaet', () => this.show(), 'big go', '▶'),
        button(
          'spil.opgiv',
          () => {
            this.show();
            c.resign(me);
          },
          '',
          '🏳️',
        ),
        button('slut.menu', () => this.menu(), '', '🏠'),
      ),
    );
  }

  private gameOver(view: GameView) {
    updater.setSafe(true);
    const c = this.controller!;
    const winner = view.winner!;
    const me = c.me(view);
    const iWon = !!me && view.winners.includes(me);
    sfx.play(c.mode === 'hotseat' || iWon ? 'victory' : 'sad', 300);
    const title: LineId =
      c.mode === 'hotseat'
        ? view.hold
          ? (`slut.hold_${view.winners.includes('groen') ? 'groen' : 'blaa'}` as LineId)
          : (`slut.${winner}_vinder` as LineId)
        : iWon
          ? 'slut.du_vandt'
          : c.mode === 'ai'
            ? 'slut.du_tabte'
            : 'slut.modstander_vandt';
    const reason: LineId | null =
      view.winReason === 'flag'
        ? 'kamp.flag'
        : view.winReason === 'ingen-traek'
          ? 'slut.ingen_traek'
          : view.winReason === 'opgivet'
            ? 'slut.opgivet'
            : null;
    this.hud.replaceChildren();
    const mode = c.mode;
    void this.stage.setSide(winner);
    this.show(
      h(
        'div',
        { class: `panel gameover ${winner}` },
        h('div', { class: 'trophy', 'aria-hidden': 'true' }, '🏆'),
        line(title, 'h1'),
        reason ? line(reason, 'p') : null,
        button(
          'slut.igen',
          () =>
            mode === 'online'
              ? this.onlineMenu()
              : mode === 'tutorial'
                ? this.startTutorial()
                : this.newGame(
                    mode,
                    this.lastGame?.difficulty,
                    this.lastGame?.minigames,
                    this.lastGame?.players,
                    this.lastGame?.hold,
                  ),
          'big go',
          '🔁',
        ),
        button('slut.menu', () => this.menu(), '', '🏠'),
      ),
    );
  }

  // ---------------------------------------------------------------- tutorial

  /** "Sådan spiller du": the sergeant's walkthrough on a practice board. */
  startTutorial() {
    this.leaveGame();
    this.world.use('klassisk');
    this.show();
    const c = new TutorialController();
    this.controller = c;
    this.view = null;
    this.selected = null;
    const tutorial = new Tutorial({
      hint: (squares) => this.presenter.hint(squares),
      done: (playNow) => {
        markTutorialSeen();
        if (playNow) this.chooseDifficulty();
        else this.menu();
      },
      restart: () => this.startTutorial(),
    });
    this.tutorial = tutorial;
    this.root.append(tutorial.el);
    void this.stage.setSide('groen');
    c.subscribe((view, events) => this.onView(view, events));
    tutorial.start(c.view());
  }

  // ---------------------------------------------------------------- online

  private onlineMenu() {
    this.leaveGame();
    this.show(
      h(
        'div',
        { class: 'panel' },
        line('online.titel', 'h2'),
        button('online.opret', () => this.chooseMinigames('online'), 'big', '➕'),
        button('online.deltag', () => this.keypad(), 'big', '🔢'),
        button('menu.tilbage', () => this.menu(), 'small', '↩'),
      ),
    );
  }

  private leaveGame() {
    this.tutorial?.dispose();
    this.tutorial = null;
    this.controller?.dispose();
    this.controller = null;
    this.setupState = null;
    this.handingOver = false;
    this.inMinigame = false;
    this.opponentHere = false;
    this.presenter.reset();
    this.hud.replaceChildren();
    this.banner.replaceChildren();
    updater.setSafe(true);
  }

  private async createOnline(minigames: MinigameMode) {
    this.show(h('div', { class: 'panel' }, line('online.forbinder', 'h2')));
    try {
      this.attachOnline(await OnlineController.create({ minigames }));
    } catch (err) {
      this.onlineFailed(err);
    }
  }

  async joinOnline(code: string) {
    this.leaveGame();
    this.show(h('div', { class: 'panel' }, line('online.forbinder', 'h2')));
    try {
      this.attachOnline(await OnlineController.join(code));
    } catch (err) {
      this.onlineFailed(err, true);
    }
  }

  /** Back into a game after a reload. Returns false when there was nothing to resume. */
  async resumeOnline(): Promise<boolean> {
    const c = await OnlineController.resume();
    if (!c) return false;
    // The server tells us straight away whether the other player is still there.
    this.attachOnline(c);
    return true;
  }

  private onlineFailed(err: unknown, retryJoin = false) {
    const reason = err instanceof OnlineError ? err.reason : 'offline';
    const id: LineId =
      reason === 'not-found'
        ? 'online.ukendt_kode'
        : reason === 'full'
          ? 'online.fuld'
          : reason === 'outdated'
            ? 'online.forsinket'
            : 'online.ingen_net';
    this.show(
      h(
        'div',
        { class: 'panel' },
        line(id, 'h2'),
        retryJoin ? button('online.deltag', () => this.keypad(), 'big', '🔢') : null,
        button('menu.tilbage', () => this.onlineMenu(), 'small', '↩'),
      ),
    );
  }

  private attachOnline(c: OnlineController) {
    this.controller = c;
    this.view = null;
    this.selected = null;
    this.lastGame = null;
    c.onOpponent = (connected) => {
      const was = this.opponentHere;
      this.opponentHere = connected;
      if (this.view?.phase === 'setup') this.onlineSetupStep();
      else if (was && !connected) toast('online.modstander_vaek', 4000);
      else if (!was && connected && this.view) toast('online.modstander_tilbage');
    };
    c.onConnection = (online) => toast(online ? 'online.tilbage' : 'online.mistet', 3000);
    c.subscribe((view, events) => this.onView(view, events));
  }

  /** Online setup: wait for a friend, then stand up our army, then wait for theirs. */
  private onlineSetupStep() {
    const c = this.controller;
    const view = this.view;
    if (!(c instanceof OnlineController) || !view || this.setupState) return;
    const me = c.team;
    if (!me) return;
    if (view.placed[me]) {
      this.show(h('div', { class: 'panel' }, line('online.venter_opstilling', 'h2')));
    } else if (this.opponentHere) {
      toast(teamLine('online.du_er', me));
      this.startSetup(me);
    } else {
      this.waitingRoom(c.code);
    }
  }

  private waitingRoom(code: string) {
    updater.setSafe(true);
    const url = `${location.origin}/?rum=${code}`;
    const qr = h('div', { class: 'qr', 'aria-hidden': 'true' });
    qr.innerHTML = renderSVG(url, { border: 1 });
    this.show(
      h(
        'div',
        { class: 'panel waiting' },
        line('online.din_kode', 'h2'),
        h(
          'div',
          { class: 'code' },
          ...[...code].map((d) => h('span', { 'data-line': `tal.${d}` }, d)),
        ),
        qr,
        line('online.vis_kode', 'p'),
        line('online.venter', 'p', 'hint'),
        button('menu.tilbage', () => this.onlineMenu(), 'small', '↩'),
      ),
    );
  }

  /** Big number pad: no keyboard needed to type a friend's code. */
  private keypad() {
    let code = '';
    const boxes = [0, 1, 2, 3].map(() => h('span', { class: 'digit' }));
    const go = button('online.forbind', () => void this.joinOnline(code), 'big go', '▶');
    go.disabled = true;
    const render = () => {
      boxes.forEach((b, i) => (b.textContent = code[i] ?? ''));
      go.disabled = code.length !== 4;
    };
    const key = (d: string) =>
      h(
        'button',
        {
          class: 'btn key',
          'data-line': `tal.${d}`,
          onclick: () => {
            if (code.length < 4) code += d;
            render();
          },
        },
        d,
      );
    const del = button(
      'online.slet',
      () => {
        code = code.slice(0, -1);
        render();
      },
      'key small',
      '⌫',
    );
    this.show(
      h(
        'div',
        { class: 'panel keypad' },
        line('online.skriv_kode', 'h2'),
        h('div', { class: 'code' }, ...boxes),
        h(
          'div',
          { class: 'keys' },
          ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
          del,
          key('0'),
        ),
        go,
        button('menu.tilbage', () => this.onlineMenu(), 'small', '↩'),
      ),
    );
  }

  // ---------------------------------------------------------------- battles

  private inMinigame = false;
  private lastGame: {
    mode: 'ai' | 'hotseat';
    difficulty: Difficulty;
    minigames: MinigameMode;
    players: 2 | 3 | 4;
    hold: boolean;
  } | null = null;

  /** A close fight: everyone on this device plays the battle's mini-game in turn. */
  private async playBattle(view: GameView) {
    const c = this.controller;
    const b = view.pendingBattle;
    if (!c || !b || this.inMinigame) return;
    const att = view.pieces.find((p) => p.id === b.attackerId);
    const def = view.pieces.find((p) => p.id === b.defenderId);
    if (!att?.rank || !def?.rank) return;
    this.inMinigame = true;
    updater.setSafe(false);
    this.banner.replaceChildren();
    this.hud.replaceChildren();
    try {
      for (const team of c.localPlayers(att.team, def.team)) {
        const mine = team === att.team ? att : def;
        const score = await runMinigame(this.stage, this.screen, b.game, {
          kit: this.kit,
          seed: b.seed,
          handicap: team === att.team ? b.handicap.attacker : b.handicap.defender,
          team,
          rank: mine.rank!,
        });
        if (this.controller !== c) return; // left the game meanwhile
        c.reportMinigame(team, score);
      }
    } finally {
      this.inMinigame = false;
    }
  }

  /** "Den gråblå hær er ude!" – shown while that army's soldiers go into its toy box. */
  async armyOut(team: Team) {
    sfx.play('sad');
    this.banner.replaceChildren(
      h('div', { class: `battle out ${team}` }, line(teamLine('spil.ude', team), 'span', 'verb')),
    );
    await new Promise((r) => setTimeout(r, 1800));
    this.banner.replaceChildren();
  }

  async showBattle(info: BattleInfo) {
    this.banner.replaceChildren(
      h(
        'div',
        { class: `battle ${info.attackerTeam}` },
        rankLabel(info.attackerRank),
        line('kamp.angriber', 'span', 'verb'),
        rankLabel(info.defenderRank),
      ),
    );
    await new Promise((r) => setTimeout(r, 1400));
    const outcomeLine: LineId | null =
      info.reason === 'mine'
        ? 'kamp.mine'
        : info.reason === 'mine-desarmeret'
          ? 'kamp.desarmeret'
          : info.reason === 'spion'
            ? 'kamp.spion'
            : info.reason === 'lige'
              ? 'kamp.begge'
              : null;
    this.pendingOutcome = { info, outcomeLine };
  }

  private pendingOutcome: { info: BattleInfo; outcomeLine: LineId | null } | null = null;

  battleResolved(outcome: string) {
    const po = this.pendingOutcome;
    this.pendingOutcome = null;
    if (!po) return;
    let el: HTMLElement;
    if (po.outcomeLine) el = line(po.outcomeLine, 'span', 'verb');
    else if (outcome === 'both') el = line('kamp.begge', 'span', 'verb');
    else {
      const rank = outcome === 'attacker' ? po.info.attackerRank : po.info.defenderRank;
      el = h('span', {}, rankLabel(rank), ' ', line('kamp.vinder', 'span', 'verb'));
    }
    this.banner.replaceChildren(h('div', { class: 'battle result' }, el));
    setTimeout(() => this.banner.replaceChildren(), 1600);
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const canvas = this.stage.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener(
      'pointerdown',
      (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }),
    );
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved > 10 || !quick) return; // that was a camera drag
      // Lifting a finger after a pinch or twist isn't a tap either.
      if (performance.now() - this.stage.controls.lastMultiTouch < 400) return;
      if (!this.controller && !this.racing && this.launcher.hit(e.clientX, e.clientY)) {
        void this.startRace();
        return;
      }
      const sq = this.stage.pick(e.clientX, e.clientY, this.presenter.boardPieces());
      if (sq) this.tap(sq);
    });
  }

  private tap(sq: Pos) {
    if (this.setupState) {
      this.setupTap(sq);
      return;
    }
    const c = this.controller;
    const view = this.view;
    if (!c || !view || this.animating || this.handingOver || view.phase !== 'play') return;
    const me = c.me(view);
    if (!me || view.turn !== me) return;
    const piece = pieceAt(view.pieces, sq);
    if (piece && piece.team === me) {
      const targets = legalTargets(
        view.pieces,
        view.history,
        piece,
        BOARDS[view.board],
        side(me, view.hold),
      );
      if (!targets.length) toast('spil.kan_ikke_flytte', 2000);
      else if (piece.rank)
        toast([rankLine(piece.rank), rankInfo(piece.rank)], 2500, insignia(piece.rank));
      this.selected = targets.length ? piece.id : null;
      this.presenter.select(this.selected, targets);
      return;
    }
    const sel = this.selected ? view.pieces.find((p) => p.id === this.selected) : null;
    if (
      sel &&
      legalTargets(view.pieces, view.history, sel, BOARDS[view.board], side(me, view.hold)).some(
        (p) => samePos(p, sq),
      )
    ) {
      this.selected = null;
      c.move(me, sel.id, sq);
      return;
    }
    this.selected = null;
    this.presenter.select(null, []);
    this.tutorial?.rehint();
  }
}

const MINIGAMES_KEY = 'antego.minigames';

function savedMinigames(): MinigameMode {
  try {
    const m = localStorage.getItem(MINIGAMES_KEY);
    // Anything but a saved "aldrig" (including the old "altid"/"taette") means mini-games on.
    return m === 'aldrig' ? 'aldrig' : 'lige';
  } catch {
    return 'lige';
  }
}

function saveMinigames(m: MinigameMode) {
  try {
    localStorage.setItem(MINIGAMES_KEY, m);
  } catch {
    // Not remembered in private mode; the default applies next time.
  }
}

const TUTORIAL_KEY = 'antego.tutorial';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return true; // without storage, don't force the tutorial on every visit
  }
}

function markTutorialSeen() {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // Not remembered in private mode.
  }
}
