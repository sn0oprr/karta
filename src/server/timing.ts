/** Timings (ms). Client animations are paced to roughly match these. Tests shrink them all. */
export const TIMING = {
  gameStart: 400,
  dealInitialExtra: 400,
  twoPlayerExtra: 100,
  dealPerCard: 110,
  dealTablePerCard: 160,
  dealBase: 700,
  playLay: 900,
  playCapture: 1300,
  chkobbaBonus: 1700,
  roundEnd: 1800,
  /** Belote: the card turned up after the deal, a pass, a take, a card into the trick, a finished trick. */
  beloteTurnUp: 600,
  belotePass: 450,
  beloteTake: 900,
  belotePlay: 650,
  beloteTrick: 1250,
  /** Extra time after the first trick when announcements are settled. */
  beloteDeclarations: 900,
  botThinkMin: 650,
  botThinkMax: 1500,
  autopilotDelay: 1100,
  /** Disconnected seated players are auto-played after this grace period (in game). */
  autopilotGrace: 20_000,
  /** Disconnected members are removed from the lobby after this. */
  lobbyGrace: 45_000,
  hostGrace: 20_000,
  /** Results screen duration before the next hand starts automatically. */
  roundPause: 15_000,
  /** Delay before the next hand once everyone pressed "continue". */
  nextRoundDelay: 800,
  minDelay: 400,
  /** Results pause when only bots are seated (spectators watching). */
  botsOnlyPause: 7000,
};
