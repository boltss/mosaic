import { useState } from 'react';
import type { FileSide, FileSummary, PullRequest, ReviewSource } from '../shared/types.ts';
import { Alert } from './components/Alert.tsx';
import { classNames } from './components/classNames.ts';
import { Skeleton } from './components/Skeleton.tsx';
import { useImage } from './data.ts';

const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

interface ImageBodyProps {
  source: ReviewSource;
  pullRequest: PullRequest;
  file: FileSummary;
  /** Give the pictures room (the diff panel) instead of keeping them tile-sized. */
  large?: boolean;
}

function ImageSide({
  source,
  pullRequest,
  file,
  large,
  side,
  label,
}: ImageBodyProps & { side: FileSide; label: string }) {
  const image = useImage(source, pullRequest, file.path, side, true);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const notFound = image.isSuccess && !image.data;
  const failed = image.isError || broken || notFound;
  return (
    <figure
      data-slot="image-side"
      data-side={side}
      className={classNames(
        'min-w-0 flex-[1_1_120px] overflow-hidden rounded-lg border',
        side === 'old' ? 'border-danger/55' : 'border-success/55',
      )}
    >
      <figcaption className="flex justify-between gap-2 bg-surface px-2 py-[3px] text-xs text-muted">
        <b>{label}</b>
        {image.data && !failed && (
          <span>
            {dimensions && `${dimensions} · `}
            {formatBytes(image.data.bytes)}
          </span>
        )}
      </figcaption>
      {failed ? (
        <Alert variant="warning" title={image.isError ? image.error.message : undefined}>
          {notFound ? 'Image not found at this commit.' : "Couldn't show this image."}
        </Alert>
      ) : image.data ? (
        <img
          // The checkerboard makes transparent areas visible.
          className={classNames(
            'mx-auto my-2 block max-w-full object-contain [background:repeating-conic-gradient(var(--border-subtle)_0%_25%,transparent_0%_50%)_50%/14px_14px]',
            large ? 'max-h-[70vh]' : 'max-h-[260px]',
          )}
          src={image.data.url}
          alt={`${label}: ${file.path}`}
          onLoad={event => setDimensions(`${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`)}
          onError={() => setBroken(true)}
        />
      ) : (
        <Skeleton />
      )}
    </figure>
  );
}

/** A binary image file: the picture itself, before and after when it changed. */
export function ImageBody(props: ImageBodyProps) {
  const { status } = props.file;
  return (
    <div data-slot="image-diff" className="flex flex-wrap gap-2 p-2">
      {status !== 'added' && <ImageSide {...props} side="old" label={status === 'deleted' ? 'Deleted' : 'Before'} />}
      {status !== 'deleted' && <ImageSide {...props} side="new" label={status === 'added' ? 'Added' : 'After'} />}
    </div>
  );
}
