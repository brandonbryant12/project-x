import { structureVoiceTranscript } from '@repo/domain';
import { Button, CatalystArc, cn, Textarea } from '@repo/ui';
import { MicIcon, SquareIcon, WandSparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { useVoiceDictation } from '@/lib/voice-capture.ts';

/**
 * Voice-to-Structured-Note Capture bar:
 * - Push-to-talk Web Speech API dictation (where supported)
 * - Always-available "Paste & structure" mode for Zoom/Teams/phone memos
 * - Automatically splits spoken notes into "What went well" + "Try next time"
 *   via `@repo/domain`'s pure `structureVoiceTranscript` while keeping PII rules active.
 */
export const VoiceNoteBar = ({
  onApply,
  subjectFirstName,
}: {
  readonly onApply: (structured: { readonly saw: string; readonly next: string }) => void;
  readonly subjectFirstName: string;
}) => {
  const voice = useVoiceDictation();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [rawPaste, setRawPaste] = useState('');
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const applyRaw = (raw: string) => {
    const structured = structureVoiceTranscript(raw);
    if (!structured.saw) return;
    onApply({ saw: structured.saw, next: structured.next });
    setStatusNote(
      structured.next
        ? 'Structured into “What went well” and “Try next time” — review before publishing.'
        : 'Added to “What went well” — add a “Next time…” cue anytime to auto-split.',
    );
    voice.clear();
    setRawPaste('');
    setPasteOpen(false);
  };

  const handleStopAndStructure = () => {
    const captured = voice.transcript;
    voice.stop();
    if (captured.trim().length > 0) applyRaw(captured);
  };

  return (
    <div className="grid gap-2.5 rounded-card border border-line bg-sunken/70 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-meta font-medium text-ink">
          <CatalystArc size={13} />
          <span>Voice-to-structured note</span>
          <span className="hidden text-ink-3 sm:inline">
            · say “next time…” to split automatically
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {voice.supported && voice.listening ? (
            <Button type="button" size="sm" variant="primary" onClick={handleStopAndStructure}>
              <SquareIcon className="size-3.5" /> Stop &amp; structure
            </Button>
          ) : null}
          {voice.supported && !voice.listening ? (
            <Button type="button" size="sm" variant="secondary" onClick={voice.start}>
              <MicIcon className="size-3.5" /> Dictate note
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => setPasteOpen((v) => !v)}>
            <WandSparklesIcon className="size-3.5" />
            {pasteOpen ? 'Close' : 'Paste & structure'}
          </Button>
        </div>
      </div>

      {voice.listening ? (
        <div className="grid gap-1.5 rounded-control border border-primary/30 bg-surface p-3">
          <div className="flex items-center gap-2 text-meta font-medium text-primary-ink">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            Listening… speak naturally about {subjectFirstName}’s meeting (no client names).
          </div>
          <p className="text-ui text-ink-2">{voice.transcript || 'Waiting for speech…'}</p>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="grid gap-2">
          <Textarea
            rows={3}
            value={rawPaste}
            onChange={(e) => setRawPaste(e.target.value)}
            placeholder={`Paste a voice memo or raw debrief note, e.g. “${subjectFirstName} paused after asking about retirement goals and reflected both spouses’ priorities. Next time, ask which trade-off matters most before showing projections.”`}
            className="bg-surface text-ui"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={rawPaste.trim().length < 8}
              onClick={() => applyRaw(rawPaste)}
            >
              Structure into fields
            </Button>
          </div>
        </div>
      ) : null}

      {voice.error ? (
        <p role="alert" className="text-meta text-warning-ink">
          {voice.error}
        </p>
      ) : null}

      {statusNote ? (
        <p aria-live="polite" className={cn('text-meta text-primary-ink')}>
          {statusNote}
        </p>
      ) : null}
    </div>
  );
};
