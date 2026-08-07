import Balancer from "./balancer";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // "Edit teams" on the bracket links back here as /?t=<id> so the balancer can
  // restore that exact tournament (with its teams + saved advancements) instead
  // of coming back to an empty picker.
  const t = (await searchParams).t;
  const initialTournamentId = typeof t === "string" ? t : null;
  return <Balancer initialTournamentId={initialTournamentId} />;
}
