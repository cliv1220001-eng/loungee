import { Suspense } from "react";
import BracketView from "./bracket-view";

export default function BracketPage() {
  // BracketView reads the tournament id from the URL (?t=<id>) via
  // useSearchParams, which Next requires be wrapped in Suspense.
  return (
    <Suspense fallback={null}>
      <BracketView />
    </Suspense>
  );
}
