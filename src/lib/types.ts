export type Role = 1 | 2 | 3 | 4 | 5;

export const ROLE_LABELS: Record<Role, string> = {
  1: "Carry",
  2: "Mid",
  3: "Offlane",
  4: "Soft Support",
  5: "Hard Support",
};

export interface Player {
  id: string;
  name: string;
  mmr: number;
  role: Role | null;
  /** Players sharing a non-null lockGroup are always placed on the same team. */
  lockGroup?: string | null;
}

export interface Team {
  id: number;
  players: Player[];
  totalMmr: number;
}
