import { structureVoiceTranscript } from '@repo/domain';
import { Button, CatalystArc, cn, Pill, Textarea } from '@repo/ui';
import { CheckIcon, MicIcon, SquareIcon, WandSparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { useVoiceDictation } from '@/lib/voice-capture.ts';

const VoiceWaveform = () => (
  <span className="inline-flex h-3.5 items-center gap-[2px]" aria-hidden>
    <span className="h-full w-[2.5px] origin-bottom animate-voice-bar rounded-full bg-primary [animation-delay:0ms]" />
    <span className="h-full w-[2.5px] origin-bottom animate-voice-bar rounded-full bg-brass [animation-delay:180ms]" />
    <span className="h-full w-[2.5px] origin-bottom animate-voice-bar rounded-full bg-primary [animation-delay:360ms]" />
  </span>
);

/**
 * Voice-to-Structured-Note Capture bar:
 * - Push-to-talk Web Speech API dictation (where supported)
 * - Always-available "Paste & structure" mode for Zoom/Teams/phone memos
 * - Live split-cue indicator so speakers know when "What went well" + "Try next time"
 *   will auto-separate cleanly via `@repo/domain`'s pure `structureVoiceTranscript`.
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

  const liveDraft = voice.listening ? voice.transcript : rawPaste;
  const splitReady =
    liveDraft.trim().length > 10 && structureVoiceTranscript(liveDraft).next !== '';

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
    <div
      className={cn(
        'grid gap-2.5 rounded-card border p-3.5 transition-[border-color,background-color] duration-200 ease-standard',
        voice.listening ? 'border-primary/45 bg-primary-soft/25' : 'border-line bg-sunken/70',
      )}
    >
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
        <div className="grid animate-fade-up gap-1.5 rounded-control border border-primary/30 bg-surface p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-meta font-medium text-primary-ink">
              <VoiceWaveform />
              Listening… speak naturally about {subjectFirstName}’s meeting (no client names).
            </div>
            {splitReady ? (
              <Pill tone="primary">
                <CheckIcon className="mr-0.5 size-3" /> Auto-split detected
              </Pill>
            ) : null}
          </div>
          <p className="text-ui text-ink-2">{voice.transcript || 'Waiting for speech…'}</p>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="grid animate-fade-up gap-2">
          <Textarea
            rows={3}
            value={rawPaste}
            onChange={(e) => setRawPaste(e.target.value)}
            placeholder={`Paste a voice memo or raw debrief note, e.g. “${subjectFirstName} paused after asking about retirement goals and reflected both spouses’ priorities. Next time, ask which trade-off matters most before showing projections.”`}
            className="bg-surface text-ui"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {splitReady ? (
              <Pill tone="primary">
                <CheckIcon className="mr-0.5 size-3" /> Will split into What went well + Try next
                time
              </Pill>
            ) : (
              <span className="text-meta text-ink-3">
                Tip: include “Next time…” to populate both fields at once.
              </span>
            )}
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
        <p role="alert" className="animate-fade-up text-meta text-warning-ink">
          {voice.error}
        </p>
      ) : null}

      {statusNote ? (
        <p aria-live="polite" className="animate-fade-up text-meta text-primary-ink">
          {statusNote}
        </p>
      ) : null}
    </div>
  );
};
