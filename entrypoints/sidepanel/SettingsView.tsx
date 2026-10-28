import { useEffect, useState } from "react";
import type { HelperStatus } from "../../lib/helper.ts";
import { saveSettings } from "../../lib/store.ts";
import { levels, maxExtraInstructionsLength, maxPromptTemplateLength, models, parseSettings, type Settings } from "../../shared/settings.ts";
import { speechAccents, speechRates } from "../../shared/speech.ts";
import { defaultPromptTemplate } from "../../shared/translate.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { VoicePicker } from "./VoicePicker.tsx";

interface Props {
  settings: Settings;
  status: HelperStatus | null;
  onRefreshStatus(): void;
  onDone(): void;
}

export function SettingsView({ settings, status, onRefreshStatus, onDone }: Props) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  // Another panel (or window) saved: start from what is stored, unless this one has unsaved edits.
  useEffect(() => {
    if (!dirty) setDraft(settings);
  }, [settings]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft(current => ({ ...current, [key]: value }));

  const save = async () => {
    // The custom prompt equal to the built-in one is stored as empty, so later improvements to the default apply.
    const next = parseSettings({ ...draft, promptTemplate: draft.promptTemplate.trim() === defaultPromptTemplate.trim() ? "" : draft.promptTemplate });
    await saveSettings(next);
    setDraft(next);
    setSaved(true);
  };

  return (
    <form
      className="panel-settings"
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>Settings</h2>

      <fieldset>
        <legend>Claude account</legend>
        <ConnectionStatus status={status} hasKey={Boolean(settings.apiKey.trim())} onRefresh={onRefreshStatus} />
        <label className="field">
          <span>Anthropic API key (fallback)</span>
          <div className="field-row">
            <input
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={draft.apiKey}
              onChange={event => set("apiKey", event.target.value)}
            />
            <button type="button" className="tl-button" onClick={() => setShowKey(!showKey)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <small>
            Used only when Claude Code isn't set up or signed in on this computer. Stored only in this browser and sent only to api.anthropic.com. Get one at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            ; API use is billed separately from a Claude plan.
          </small>
        </label>
        <label className="field">
          <span>Model</span>
          <select value={draft.model} onChange={event => set("model", event.target.value as Settings["model"])}>
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <small>On your Claude account, lookups count toward your plan's usage; on an API key, they are billed per use.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>You</legend>
        <label className="field">
          <span>Translate into (your language)</span>
          <input type="text" maxLength={60} value={draft.targetLanguage} onChange={event => set("targetLanguage", event.target.value)} />
        </label>
        <label className="field">
          <span>Your English level</span>
          <select value={draft.level} onChange={event => set("level", event.target.value as Settings["level"])}>
            {levels.map(level => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
          <small>Sets which words get explained and how simple the English check's explanations are.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>Pronunciation</legend>
        <label className="field">
          <span>Accent</span>
          {/* A new accent starts from its own best voice. */}
          <select
            value={draft.speechAccent}
            onChange={event => setDraft(current => ({ ...current, speechAccent: event.target.value as Settings["speechAccent"], speechVoice: "" }))}
          >
            {speechAccents.map(accent => (
              <option key={accent.id} value={accent.id}>
                {accent.label}
              </option>
            ))}
          </select>
        </label>
        <VoicePicker accent={draft.speechAccent} rate={draft.speechRate} value={draft.speechVoice} onChange={name => set("speechVoice", name)} />
        <label className="field">
          <span>Speed</span>
          <select value={draft.speechRate} onChange={event => set("speechRate", event.target.value as Settings["speechRate"])}>
            {speechRates.map(rate => (
              <option key={rate.id} value={rate.id}>
                {rate.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>On web pages</legend>
        <label className="check">
          <input type="checkbox" checked={draft.showTranslateButton} onChange={event => set("showTranslateButton", event.target.checked)} />
          <span>Show the Translate button when I select text</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.showCheckButton} onChange={event => set("showCheckButton", event.target.checked)} />
          <span>Show the Check my English button in text boxes</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Lesson prompt</legend>
        <label className="field">
          <span>Translation prompt</span>
          <textarea
            rows={9}
            maxLength={maxPromptTemplateLength}
            placeholder={defaultPromptTemplate}
            value={draft.promptTemplate}
            onChange={event => set("promptTemplate", event.target.value)}
          />
          <small>
            Empty uses the built-in prompt shown above. <code>{"{{text}}"}</code> is the selection, <code>{"{{sentence}}"}</code> the text around it,{" "}
            <code>{"{{language}}"}</code> and <code>{"{{level}}"}</code> your settings. The reply format is always added after it.
          </small>
          <div className="tl-actions">
            <button type="button" className="tl-button" onClick={() => set("promptTemplate", defaultPromptTemplate)}>
              Edit the built-in prompt
            </button>
            {draft.promptTemplate ? (
              <button type="button" className="tl-button" onClick={() => set("promptTemplate", "")}>
                Reset to built-in
              </button>
            ) : null}
          </div>
        </label>
        <label className="field">
          <span>Extra instructions</span>
          <textarea
            rows={3}
            maxLength={maxExtraInstructionsLength}
            placeholder="For example: prefer medical senses of words."
            value={draft.extraInstructions}
            onChange={event => set("extraInstructions", event.target.value)}
          />
          <small>Added to the end of every lesson prompt.</small>
        </label>
      </fieldset>

      <div className="panel-settings-footer">
        <button type="submit" className="tl-button tl-button-primary" disabled={!dirty}>
          Save
        </button>
        <button type="button" className="tl-button" onClick={onDone}>
          {dirty ? "Cancel" : "Back"}
        </button>
        {saved ? (
          <span className="panel-saved" role="status">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
