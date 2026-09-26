import { Toast, showToast } from "@vicinae/api";
import { PAGES, getTtlMs, refreshPages } from "./lib/data";

export default async function Command() {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Refreshing FMHY data…",
  });

  const result = await refreshPages({ ttlMs: getTtlMs(), force: true });

  if (result.failed.length === PAGES.length) {
    toast.style = Toast.Style.Failure;
    toast.title = "Couldn't reach FMHY";
    toast.message = result.failed[0];
  } else if (result.failed.length > 0) {
    toast.style = Toast.Style.Failure;
    toast.title = `Refreshed with ${result.failed.length} failed page${result.failed.length === 1 ? "" : "s"}`;
    toast.message = result.failed.join(", ");
  } else {
    toast.style = Toast.Style.Success;
    toast.title = result.updated > 0 ? "FMHY data updated" : "FMHY data is up to date";
    toast.message = `${result.updated} changed, ${result.unchanged} unchanged`;
  }
}
