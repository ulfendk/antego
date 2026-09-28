import '@fontsource/black-ops-one/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/900.css';
import './style.css';
import { isRoomCode } from '@antego/shared';
import { App } from './app.js';
import { runMinigame } from './minigames/runner.js';
import { updater } from './pwa/updater.js';
import { buildTable } from './scene/board.js';
import { buildProps } from './scene/props.js';
import { PieceKit } from './scene/pieces.js';
import { Presenter } from './scene/presenter.js';
import { SETTINGS, detectQuality, saveQuality, savedQuality } from './scene/quality.js';
import { Stage } from './scene/stage.js';
import { h } from './ui/dom.js';
import { startReader } from './voice/reader.js';
import { voice } from './voice/voice.js';
import { ALL_SOUNDS, measureSound, sfx } from './audio/sfx.js';

updater.start();
startReader();
// Every button gives a soft plastic click.
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest('.btn')) sfx.play('click');
  },
  { capture: true },
);
void voice.load();

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

const bar = h('div', { class: 'bar' });
const loading = h(
  'div',
  { class: 'loading' },
  h('img', { src: '/logo.svg', alt: '' }),
  h('div', { class: 'progress' }, bar),
);
ui.append(loading);

async function boot() {
  // Fonts are drawn into the badge and card textures, so wait for them.
  await document.fonts.load('64px "Black Ops One"').catch(() => undefined);
  const quality = detectQuality();
  const stage = new Stage(canvas, quality);
  const { table, print } = buildTable(SETTINGS[quality].printSize);
  stage.scene.add(table);
  const kit = await PieceKit.load(
    SETTINGS[quality].lod0Distance,
    (k) => (bar.style.width = `${Math.round(k * 100)}%`),
  );
  let app: App | null = null;
  const presenter = new Presenter(kit, {
    onBattle: (info) => app!.showBattle(info),
    onBattleResolved: (outcome) => app!.battleResolved(outcome),
    focus: (p) => stage.focus(p),
    unfocus: () => stage.unfocus(),
  });
  stage.scene.add(presenter.group);
  stage.scene.add(buildProps(kit, print));
  stage.onFrame = (dt) => presenter.update(dt);
  // Automatic tier only: if this device struggles, step down once.
  stage.onSlow = () => {
    if (savedQuality() || stage.quality === 'lav') return;
    const next = stage.quality === 'hoej' ? 'mellem' : 'lav';
    stage.setQuality(next);
    stage.resetFrameWatch();
    saveQuality(null);
  };
  app = new App(ui, stage, presenter, kit);
  loading.remove();
  // ?debug exposes internals for screenshots and poking around in devtools.
  if (new URLSearchParams(location.search).has('debug')) {
    const layer = document.querySelector<HTMLElement>('.screen-layer')!;
    const testMinigame = (game: 'stormloeb' | 'korkskud' | 'faldskaerm', handicap = 0) =>
      runMinigame(stage, layer, game, {
        kit,
        seed: 1234,
        handicap,
        team: 'groen',
        rank: 'sergent',
      });
    Object.assign(window, {
      app,
      stage,
      presenter,
      kit,
      testMinigame,
      sfx,
      measureSound,
      ALL_SOUNDS,
    });
  }
  // A shared link (?rum=1234) joins that game; a reload rejoins the game we were in.
  const room = new URLSearchParams(location.search).get('rum');
  if (room && isRoomCode(room)) {
    history.replaceState(null, '', location.pathname);
    void app.joinOnline(room);
  } else if (!(await app.resumeOnline())) {
    app.menu();
  }
}

void boot();
