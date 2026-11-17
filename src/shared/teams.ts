/** Partnerships: with 4 players, partners sit opposite each other (seats 0 & 2 against 1 & 3). */
export type Team = 0 | 1;

export function teamOf(seat: number): Team {
  return (seat % 2) as Team;
}
