import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./ui.module.scss";

interface ErrorBoundaryProps {
  /** Shown in the fallback, e.g. "Timeline". */
  name: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains a crash to one panel instead of blanking the whole app. The project
 * state lives in the store, so "Try again" usually recovers without data loss.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.errorPanel} role="alert">
        <span className={styles.errorTitle}>{this.props.name} hit an error</span>
        <span className={styles.errorMessage}>{error.message}</span>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
