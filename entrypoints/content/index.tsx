import ReactDOM from "react-dom/client";
import "../../components/ui.css";
import { App } from "./App.tsx";
import "./style.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  // The UI's CSS goes into its shadow root, so the page's styles and ours never touch.
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "translate-learn-ui",
      position: "inline",
      anchor: "html",
      append: "last",
      onMount(container, _shadow, host) {
        const root = ReactDOM.createRoot(container);
        root.render(<App host={host} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
