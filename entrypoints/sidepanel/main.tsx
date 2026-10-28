import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "../../components/ui.css";
import { Panel } from "./Panel.tsx";
import "./style.css";

document.documentElement.classList.add("tl-theme");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
