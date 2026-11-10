import { useState } from 'react';
import {
  estimateGithubMinutes,
  formatClock,
  formatMinutes,
  MINIMUM_BASELINE_PULL_REQUESTS,
  savedMinutes,
  thisWeek,
} from '../metrics/metrics.ts';
import { Button } from './components/Button.tsx';
import { classNames } from './components/classNames.ts';
import { Dialog, DialogDescription, DialogTitle } from './components/Dialog.tsx';
import { Table, TableCell, TableHead, TableRow } from './components/Table.tsx';
import { useSession, type MosaicSession } from './metricsStore.ts';

const formatSaved = (minutes: number | null) =>
  minutes == null ? '—' : minutes > 0 ? `−${formatMinutes(minutes)}` : '±0';
const formatEstimate = (minutes: number | null) => (minutes == null ? '—' : formatMinutes(minutes));

/** The running clock in the top bar; opens the summary. */
export function TimeChip({ session, onClick }: { session: MosaicSession; onClick: () => void }) {
  const view = useSession(session);
  const saved = savedMinutes({ mosaicLines: view.mosaicLines, mosaicSeconds: view.seconds }, view.baseline);
  return (
    <Button variant="pill" onClick={onClick} title="Active review time (t)">
      ⏱ <b className="text-foreground tabular-nums">{formatClock(view.seconds)}</b>
      {saved != null && saved >= 1 && (
        <span>
          · <span className="font-semibold text-success">~{formatMinutes(saved)} saved</span>
        </span>
      )}
    </Button>
  );
}

function Statistic({ value, label, positive = false }: { value: string; label: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-subtle bg-background px-2.5 py-2">
      <div className={classNames('text-2xl font-semibold tabular-nums', positive && 'text-success')}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export function SummaryDialog({
  session,
  totalLines,
  title,
  done,
  onClose,
}: {
  session: MosaicSession;
  totalLines: number;
  title: string;
  done: boolean;
  onClose: () => void;
}) {
  const view = useSession(session);
  const estimate = estimateGithubMinutes(view.mosaicLines, view.baseline);
  const saved = savedMinutes({ mosaicLines: view.mosaicLines, mosaicSeconds: view.seconds }, view.baseline);
  const [now] = useState(() => Date.now());
  const week = thisWeek(view.allRecords, now);
  return (
    <Dialog onClose={onClose}>
      <DialogTitle>
        {done ? 'Review complete' : 'Review so far'} · {title}
      </DialogTitle>
      <DialogDescription>
        {view.mosaicLines.toLocaleString()} of {totalLines.toLocaleString()} changed lines marked viewed in Mosaic
      </DialogDescription>
      <div className="mb-3.5 grid grid-cols-3 gap-2">
        <Statistic value={formatClock(view.seconds)} label="active time in Mosaic" />
        <Statistic value={formatEstimate(estimate)} label="your GitHub pace for the same lines" />
        <Statistic
          value={formatSaved(saved)}
          label={saved == null ? 'baseline not ready' : saved > 0 ? 'saved' : 'not ahead yet'}
          positive={saved != null && saved > 0}
        />
      </div>
      <Table>
        <TableRow>
          <TableHead>Where the time went</TableHead>
          <TableHead align="right">files</TableHead>
          <TableHead align="right">lines</TableHead>
        </TableRow>
        <TableRow>
          <TableCell>Cleared in bulk (buckets, folders)</TableCell>
          <TableCell align="right">{view.bulkFiles}</TableCell>
          <TableCell align="right">{view.bulkLines.toLocaleString()}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Marked one by one</TableCell>
          <TableCell align="right">{view.oneByOneFiles}</TableCell>
          <TableCell align="right">{(view.mosaicLines - view.bulkLines).toLocaleString()}</TableCell>
        </TableRow>
      </Table>
      {week.length > 0 && (
        <Table>
          <TableRow>
            <TableHead>This week</TableHead>
            <TableHead align="right">files</TableHead>
            <TableHead align="right">Mosaic</TableHead>
            <TableHead align="right">GitHub pace</TableHead>
            <TableHead align="right">saved</TableHead>
          </TableRow>
          {week.slice(0, 8).map(record => (
            <TableRow key={record.key}>
              <TableCell title={record.key}>{record.title || record.key}</TableCell>
              <TableCell align="right">{record.files}</TableCell>
              <TableCell align="right">{formatMinutes(record.mosaicSeconds / 60)}</TableCell>
              <TableCell align="right">
                {formatEstimate(estimateGithubMinutes(record.mosaicLines, view.baseline))}
              </TableCell>
              <TableCell align="right" className="text-success">
                {formatSaved(savedMinutes(record, view.baseline))}
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}
      <div className="mt-2.5 text-xs text-faint">
        {view.baseline.ready ? (
          <>
            GitHub pace = {view.baseline.pace!.toFixed(1)}
            {' min per 100 changed lines, measured on '}
            {view.baseline.pullRequests}
            {" PRs you reviewed in GitHub's own files view."}
          </>
        ) : (
          <>
            Baseline: {view.baseline.pullRequests}/{MINIMUM_BASELINE_PULL_REQUESTS} PRs measured. Review a few PRs in
            GitHub's own files view (≥ 5 active minutes each, marking files viewed there) and Mosaic will compare.
          </>
        )}{' '}
        Active time pauses after 60 s without input or when the tab is hidden. Stored only in this browser.
      </div>
    </Dialog>
  );
}
