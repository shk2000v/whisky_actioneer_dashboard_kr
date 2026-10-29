import React from "react";
import ReactDOM from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource-variable/fraunces/full.css";
import App from "./App";
import "./styles.css";

// The web build is wrapped in a host skeleton without a lang attribute.
document.documentElement.lang = "ko";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
