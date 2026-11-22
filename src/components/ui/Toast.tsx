import { X } from "lucide-react";
import { IconButton, cx } from "./Button";
import styles from "./ui.module.scss";
import { useToastStore, type ToastKind } from "../../stores/toastStore";

export { toast } from "../../stores/toastStore";

const KIND_CLASS: Record<ToastKind, string> = {
  success: styles.toastSuccess,
  error: styles.toastError,
  info: styles.toastInfo,
};

/** Mount once near the app root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className={styles.toaster} aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={cx(styles.toast, KIND_CLASS[t.kind])} role={t.kind === "error" ? "alert" : "status"}>
          <div className={styles.toastBody}>
            <span>{t.message}</span>
            {t.detail && <span className={styles.toastDetail}>{t.detail}</span>}
          </div>
          <IconButton label="Dismiss" size="sm" icon={<X size={12} />} onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
