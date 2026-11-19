/** The crew's own portraits (cropped from their avatars), shown in the café menu and the lobby. */
import type { CrewId } from '../shared/protocol';
import saan from './assets/crew/7saan.webp';
import birrrraa3 from './assets/crew/birrrraa3.webp';
import bou3ish from './assets/crew/bou3ish.webp';
import gratos from './assets/crew/gratos.webp';
import habboub from './assets/crew/habboub.webp';
import nini from './assets/crew/nini.webp';
import rafaa from './assets/crew/rafaa.webp';
import sn0opr from './assets/crew/sn0opr.webp';
import snoussi from './assets/crew/snoussi.webp';
import ta7foun from './assets/crew/ta7foun.webp';
import tha3loub from './assets/crew/tha3loub.webp';

export const CREW_PORTRAITS: Record<CrewId, string> = {
  rafaa,
  nini,
  tha3loub,
  ta7foun,
  sn0opr,
  bou3ish,
  '7saan': saan,
  habboub,
  gratos,
  birrrraa3,
  snoussi,
};
