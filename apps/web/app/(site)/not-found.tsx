import { ErrorState } from "../ui/error-state";

export default function SiteNotFound() {
  return (
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
  );
}
