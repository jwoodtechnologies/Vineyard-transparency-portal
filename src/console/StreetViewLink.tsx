import { useContext } from "react";
import { ExternalLink } from "lucide-react";
import { ProjectViewpoint, streetViewUrl, type Pos } from "./streetView";

/** "Open in Street View" for a place, or nothing when it has no point. Pass `at`, or `project` to look it up on the map. */
export function StreetViewLink({
  at,
  project,
}: {
  at?: Pos | null;
  project?: string;
}) {
  const lookup = useContext(ProjectViewpoint);
  const pos = at ?? (project ? lookup(project) : null);
  if (!pos) return null;
  return (
    <div className="vc-sv">
      <a
        className="vc-sv-link"
        href={streetViewUrl(pos)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink size={15} strokeWidth={1.8} aria-hidden="true" /> Open in
        Street View
      </a>
      <small className="vc-sv-hint">Opens Google Street View</small>
    </div>
  );
}
