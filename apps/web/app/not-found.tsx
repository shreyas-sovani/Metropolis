import { ErrorState } from "./ui/error-state";
import { SiteChrome } from "./ui/site-chrome";
import "./ui/error-state.css";

export default function NotFound() {
  return (
    <SiteChrome>
      <div className="ui-scope">
        <div className="container section">
          <ErrorState
            title="That page isn't here"
            sentence="The link may be old. Start from the home page."
            action="Back to Lifeline"
            href="/"
          />
        </div>
      </div>
    </SiteChrome>
  );
}
