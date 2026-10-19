import { TokenActivity } from "./TokenActivity.jsx";
import { t } from "../../i18n/index.js";

export function HomeEmptyVisual({ children }) {
  return (
    <div className="codemini-home-empty-stage">
      {/* <div className="codemini-welcome-brand" aria-hidden="true">
        <span className="codemini-welcome-mark" />
        <span>codemini</span>
      </div> */}
      {children ? (
        <div className="codemini-home-empty-caption">{children}</div>
      ) : null}
      <p className="codemini-welcome-description">{t("welcomeDescription")}</p>
      <TokenActivity />
    </div>
  );
}
