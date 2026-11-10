import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import styles from 'virtual:mosaic-styles';
import type { KeyValueStore } from '../metrics/metrics.ts';
import type { ReviewSource } from '../shared/types.ts';
import { Button } from './components/Button.tsx';
import { EmptyState, EmptyStateText } from './components/EmptyState.tsx';
import { Review } from './Review.tsx';

/** Last line of defence: a render error shows a message with a close button instead of a dead overlay. */
class RootBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidMount() {
    window.addEventListener('keydown', this.onKeyDown, true);
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKeyDown, true);
  }
  onKeyDown = (event: KeyboardEvent) => {
    if (this.state.error && event.key === 'Escape') this.props.onClose();
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState className="row-[1/-1]" title="Mosaic hit an error">
        <EmptyStateText className="font-mono text-sm">{this.state.error.message}</EmptyStateText>
        <EmptyStateText>
          <Button variant="link" onClick={this.props.onClose}>
            Close Mosaic
          </Button>
        </EmptyStateText>
      </EmptyState>
    );
  }
}

export interface MountOptions {
  source: ReviewSource;
  store: KeyValueStore;
  theme: 'light' | 'dark';
  onClose: () => void;
}

/** Mounts Mosaic into `host` (inside a shadow root so GitHub's CSS can't leak in). Returns an unmount function. */
export function mountMosaic(host: HTMLElement, options: MountOptions): () => void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const style = document.createElement('style');
  style.textContent = styles;
  const container = document.createElement('div');
  // `mosaic` scopes the theme variables (see styles.css); the rest lays the overlay out over the page.
  container.className =
    'mosaic fixed inset-0 z-[2147483646] grid grid-rows-[auto_1fr_auto] bg-background text-foreground outline-none';
  container.dataset.theme = options.theme;
  container.tabIndex = -1;
  shadow.append(style, container);
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
  const root = createRoot(container);
  root.render(
    <RootBoundary onClose={options.onClose}>
      <QueryClientProvider client={client}>
        <Review source={options.source} store={options.store} onClose={options.onClose} />
      </QueryClientProvider>
    </RootBoundary>,
  );
  queueMicrotask(() => container.focus());
  return () => {
    root.unmount();
    client.clear();
    shadow.replaceChildren();
  };
}
