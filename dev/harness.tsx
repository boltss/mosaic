// Dev harness: the real Mosaic UI against a fake pull request. ?theme=light ?fail=1 ?latency=0 ?approvedBy=mari,jaan ?author=1 ?failApprove=1
import { memoryStore, type PullRequestRecord } from '../src/metrics/metrics.ts';
import { mountMosaic } from '../src/ui/entry.tsx';
import { fixtureSource } from './fixture.ts';

const parameters = new URLSearchParams(location.search);
const source = fixtureSource({
  latency: Number(parameters.getAll('latency').at(-1) ?? 250),
  failViewed: parameters.has('fail'),
  failApprove: parameters.has('failApprove'),
  approvedBy: parameters.get('approvedBy')?.split(',') ?? [],
  canApprove: !parameters.has('author'),
});
// Seed three pull requests measured in GitHub's own view so the "time saved" baseline is ready.
const DAY_MILLISECONDS = 86_400_000;
const store = memoryStore(
  Object.fromEntries(
    ['a', 'b', 'c'].map((name, index): [string, PullRequestRecord] => [
      `pr:demo/${name}#${index}`,
      {
        key: `pr:demo/${name}#${index}`,
        title: `Earlier PR ${name}`,
        files: 40,
        totalLines: 900,
        mosaicSeconds: 600 + index * 120,
        mosaicLines: 700,
        bulkLines: 300,
        bulkFiles: 20,
        githubSeconds: 1500,
        githubLines: 400 + index * 50,
        updatedAt: Date.now() - index * DAY_MILLISECONDS,
      },
    ]),
  ),
);

const host = document.getElementById('host')!;
const reopenButton = document.getElementById('reopen')!;
const open = () => {
  reopenButton.hidden = true;
  const unmount = mountMosaic(host, {
    source,
    store,
    theme: parameters.get('theme') === 'light' ? 'light' : 'dark',
    onClose: () => {
      unmount();
      reopenButton.hidden = false;
    },
    onApproved: () => {
      unmount();
      reopenButton.hidden = false;
      console.log(`approved ${source.approvedCommits.at(-1)}; the extension would now open the conversation`);
    },
  });
};
reopenButton.addEventListener('click', open);
Object.assign(window, { __mosaic: { source, store } });
open();
