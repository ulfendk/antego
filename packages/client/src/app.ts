import {
  legalTargets,
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
import { LocalController } from './game/controller.js';
import { runMinigame } from './minigames/runner.js';
import type { LineId } from './generated/lines.js';
import { updater } from './pwa/updater.js';
import type { PieceKit } from './scene/pieces.js';
import type { Presenter, BattleInfo } from './scene/presenter.js';
import { saveQuality, type Quality } from './scene/quality.js';
import type { Stage } from './scene/stage.js';
import { button, h, line, t } from './ui/dom.js';
import { toast } from './ui/toast.js';

const rankLine = (r: Rank) => `rang.${r}` as LineId;
const rankInfo = (r: Rank) => `rang.${r}_info` as LineId;

interface SetupState {
  team: Team;
  placement: Placement[];
  pick: number | null;
}

export class App {
  private controller: LocalController | null = null;
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
  ) {
    root.append(this.hud, this.banner, this.screen);
    this.bindInput();
  }

  // ---------------------------------------------------------------- screens

  private show(...children: (Node | null)[]) {
    this.screen.replaceChildren(...children.filter((c): c is Node => !!c));
  }

  menu() {
    updater.setSafe(true);
    this.controller?.dispose();
    this.controller = null;
    this.setupState = null;
    this.handingOver = false;
    this.presenter.reset();
    this.hud.replaceChildren();
    this.show(
      h(
        'div',
        { class: 'panel menu' },
        h('img', { class: 'logo', src: '/logo.svg', alt: '' }),
        line('menu.titel', 'h1', 'title'),
        button('menu.spil_computer', () => this.chooseDifficulty(), 'big', '🤖'),
        button('menu.spil_to', () => this.chooseMinigames('hotseat'), 'big', '👫'),
        button('menu.indstillinger', () => this.settings(), 'small', '⚙️'),
      ),
    );
  }

  private chooseDifficulty() {
    const pick = (d: Difficulty) => this.chooseMinigames('ai', d);
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

  private chooseMinigames(mode: 'ai' | 'hotseat', difficulty: Difficulty = 'mellem') {
    const current = savedMinigames();
    const pick = (m: MinigameMode) => {
      saveMinigames(m);
      this.newGame(mode, difficulty, m);
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
          opt('altid', 'menu.altid', '🎮'),
          opt('taette', 'menu.taette', '⚖️'),
          opt('aldrig', 'menu.aldrig', '♟️'),
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
  ) {
    this.controller?.dispose();
    this.presenter.reset();
    this.handingOver = false;
    this.inMinigame = false;
    this.banner.replaceChildren();
    this.lastGame = { mode, difficulty, minigames };
    const c = new LocalController(mode, { minigames }, difficulty);
    this.controller = c;
    this.view = null;
    this.selected = null;
    c.subscribe((view, events) => this.onView(view, events));
    this.startSetup('groen');
  }

  private startSetup(team: Team) {
    const c = this.controller!;
    updater.setSafe(true);
    c.viewer = team;
    this.setupState = { team, placement: presetPlacement(team, 'forsvar'), pick: null };
    void this.stage.setSide(team);
    this.renderSetup();
    const preset = (id: PresetId) => {
      this.setupState!.placement = presetPlacement(team, id);
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
              this.setupState!.placement = randomPlacement(team, randomSeed());
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
      toast(
        `${t(rankLine(s.placement[idx]!.rank))} – ${t(rankInfo(s.placement[idx]!.rank))}`,
        2500,
      );
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
    if (c.mode === 'hotseat' && s.team === 'groen') {
      this.handover('brun', () => this.startSetup('brun'));
    }
  }

  private onView(view: GameView, events: GameEvent[]) {
    this.view = view;
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
    c.viewer = null;
    void this.presenter.present(c.view(), []);
    void this.stage.setSide(team);
    this.hud.replaceChildren();
    this.show(
      h(
        'div',
        { class: `panel handover ${team}` },
        line(team === 'groen' ? 'spil.giv_groen' : 'spil.giv_brun', 'h2'),
        button(
          'spil.jeg_er_klar',
          () => {
            this.handingOver = false;
            this.show();
            c.viewer = team;
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
    const mine = c.mode === 'ai' ? view.turn === 'groen' : true;
    const id: LineId =
      c.mode === 'ai'
        ? mine
          ? 'spil.din_tur'
          : 'spil.computer_tur'
        : view.turn === 'groen'
          ? 'spil.tur_groen'
          : 'spil.tur_brun';
    this.hud.replaceChildren(
      h('div', { class: `turn ${view.turn}` }, line(id)),
      h(
        'button',
        {
          class: 'btn icon-only menu-btn',
          'aria-label': t('spil.menu'),
          onclick: () => this.pause(),
        },
        '☰',
      ),
    );
  }

  private pause() {
    const c = this.controller;
    if (!c) return;
    const me: Team = c.mode === 'ai' ? 'groen' : (this.view?.turn ?? 'groen');
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
    const title: LineId =
      c.mode === 'ai'
        ? winner === 'groen'
          ? 'slut.du_vandt'
          : 'slut.du_tabte'
        : winner === 'groen'
          ? 'slut.groen_vinder'
          : 'slut.brun_vinder';
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
          () => this.newGame(mode, this.lastGame?.difficulty, this.lastGame?.minigames),
          'big go',
          '🔁',
        ),
        button('slut.menu', () => this.menu(), '', '🏠'),
      ),
    );
  }

  // ---------------------------------------------------------------- battles

  private inMinigame = false;
  private lastGame: {
    mode: 'ai' | 'hotseat';
    difficulty: Difficulty;
    minigames: MinigameMode;
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

  async showBattle(info: BattleInfo) {
    this.banner.replaceChildren(
      h(
        'div',
        { class: `battle ${info.attackerTeam}` },
        line(rankLine(info.attackerRank), 'span', 'rank'),
        line('kamp.angriber', 'span', 'verb'),
        line(rankLine(info.defenderRank), 'span', 'rank'),
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
      el = h(
        'span',
        {},
        line(rankLine(rank), 'span', 'rank'),
        ' ',
        line('kamp.vinder', 'span', 'verb'),
      );
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
    const me: Team = c.mode === 'ai' ? 'groen' : view.turn;
    if (view.turn !== me) return;
    const piece = pieceAt(view.pieces, sq);
    if (piece && piece.team === me) {
      const targets = legalTargets(view.pieces, view.history, piece);
      if (!targets.length) toast(t('spil.kan_ikke_flytte'), 2000);
      else if (piece.rank) toast(`${t(rankLine(piece.rank))} – ${t(rankInfo(piece.rank))}`, 2500);
      this.selected = targets.length ? piece.id : null;
      this.presenter.select(this.selected, targets);
      return;
    }
    const sel = this.selected ? view.pieces.find((p) => p.id === this.selected) : null;
    if (sel && legalTargets(view.pieces, view.history, sel).some((p) => samePos(p, sq))) {
      this.selected = null;
      c.move(me, sel.id, sq);
      return;
    }
    this.selected = null;
    this.presenter.select(null, []);
  }
}

const MINIGAMES_KEY = 'antego.minigames';

function savedMinigames(): MinigameMode {
  try {
    const m = localStorage.getItem(MINIGAMES_KEY);
    return m === 'altid' || m === 'aldrig' || m === 'taette' ? m : 'taette';
  } catch {
    return 'taette';
  }
}

function saveMinigames(m: MinigameMode) {
  try {
    localStorage.setItem(MINIGAMES_KEY, m);
  } catch {
    // Not remembered in private mode; the default applies next time.
  }
}
