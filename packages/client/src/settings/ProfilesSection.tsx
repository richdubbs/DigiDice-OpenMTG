/**
 * Settings, Look and feel (docs/design/ui-profiles.md): the UI profiles. Choosing a profile loads it at once; the templates (Neon Grid, LCARS, Reality Fracture) are
 * read-only, so customizing starts with "Save as new profile". A saved profile's template, colors, text size and backgrounds are changed here and
 * stored at once, like every other setting; it can be renamed, deleted, exported to a file and imported again (in this or another browser).
 */
import { useId, useRef, useState, type ChangeEvent } from 'react';
import {
  MAX_PROFILE_NAME, MAX_PROFILES, TEMPLATE_IDS, TEMPLATES, TEXT_SIZES, profileFile, profilesStore, templateLook, type Look, type ProfilesStore, type UiProfile,
} from '../profiles/profiles';
import { useProfiles } from '../profiles/useProfiles';
import './settings.css';

/** A row of the profile's palette, as small color chips (decorative: the name says which profile it is). */
function Swatches({ look }: { look: Look }) {
  return (
    <span className="profile-swatches" aria-hidden="true">
      {TEMPLATES[look.template].slots.map((s) => (
        <span key={s.key} style={{ background: look.colors[s.key] }} />
      ))}
    </span>
  );
}

/** Asks for a name, then calls `onDone` with it (or closes on Cancel / Escape). */
function NameForm({ label, initial, submit, onDone, onCancel }: { label: string; initial: string; submit: string; onDone(name: string): void; onCancel(): void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="profile-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(name);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <label className="settings-field">
        <span>{label}</span>
        {/* The form opens because the player asked to type a name: the field takes the focus. */}
        <input type="text" value={name} maxLength={MAX_PROFILE_NAME} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="button-primary" disabled={name.trim() === ''}>
        {submit}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function download(name: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'profile'}.openmtg-profile.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

type Mode = { kind: 'none' } | { kind: 'saveAs' } | { kind: 'rename' } | { kind: 'delete' };

/** The customization of a saved profile. */
function Customize({ profile, store }: { profile: UiProfile; store: ProfilesStore }) {
  const { look } = profile;
  const template = TEMPLATES[look.template];
  const base = useId();
  const update = (change: Partial<Look>) => store.updateLook(profile.id, change);
  return (
    <div className="profile-customize">
      <div role="radiogroup" aria-labelledby={`${base}-template`} className="settings-radios">
        <span id={`${base}-template`} className="profile-label">
          Template
        </span>
        {TEMPLATE_IDS.map((id) => (
          <label key={id} className="settings-check">
            <input type="radio" name={`${base}-template`} checked={look.template === id} onChange={() => update({ template: id })} />
            <span>{TEMPLATES[id].name}</span>
          </label>
        ))}
      </div>
      <p className="settings-hint">{template.description} Changing the template starts from its own colors.</p>

      <div className="profile-presets" role="group" aria-labelledby={`${base}-presets`}>
        <span id={`${base}-presets`} className="profile-label">
          Palettes
        </span>
        {template.presets.map((p) => (
          <button key={p.name} type="button" className="profile-preset" onClick={() => update({ colors: { ...p.colors } })}>
            <Swatches look={{ ...look, colors: { ...p.colors } }} />
            {p.name}
          </button>
        ))}
      </div>

      <div className="profile-colors">
        {template.slots.map((slot) => (
          <label key={slot.key} className="profile-color" title={slot.hint}>
            <input type="color" value={look.colors[slot.key]} onChange={(e) => update({ colors: { ...look.colors, [slot.key]: e.target.value } })} />
            <span>
              <b>{slot.label}</b>
              <small>{slot.hint}</small>
            </span>
          </label>
        ))}
      </div>

      <div role="radiogroup" aria-labelledby={`${base}-size`} className="settings-radios">
        <span id={`${base}-size`} className="profile-label">
          Text size
        </span>
        {TEXT_SIZES.map((size) => (
          <label key={size} className="settings-check">
            <input type="radio" name={`${base}-size`} checked={look.textSize === size} onChange={() => update({ textSize: size })} />
            <span>{Math.round(size * 100)}%</span>
          </label>
        ))}
      </div>

      <label className="settings-check">
        <input type="checkbox" checked={look.scene} onChange={(e) => update({ scene: e.target.checked })} />
        <span>{template.sceneLabel}</span>
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={look.motion} onChange={(e) => update({ motion: e.target.checked })} />
        <span>Moving backgrounds</span>
      </label>
      <p className="settings-hint">Backgrounds also stay still when your system asks for reduced motion.</p>

      <button type="button" className="button-link profile-reset" onClick={() => update({ ...templateLook(look.template) })}>
        Reset to the {template.name} template
      </button>
    </div>
  );
}

export function ProfilesSection({ store = profilesStore() }: { store?: ProfilesStore }) {
  const state = useProfiles(store);
  const active = store.active();
  const all = store.all();
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [message, setMessage] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const full = state.profiles.length >= MAX_PROFILES;

  const choose = (p: UiProfile) => {
    setMode({ kind: 'none' });
    setMessage('');
    store.select(p.id);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const id = store.importText(await f.text());
    const p = id ? store.find(id) : undefined;
    setMessage(p ? `Imported and loaded "${p.name}".` : full ? `You already have ${MAX_PROFILES} profiles; delete one first.` : 'That file is not an OpenMTG profile.');
  };

  const group = (title: string, list: UiProfile[]) => (
    <>
      <p className="profile-group">{title}</p>
      {list.map((p) => {
        const on = p.id === active.id;
        return (
          <label key={p.id} className={on ? 'profile-option is-active' : 'profile-option'}>
            <input type="radio" name="ui-profile" checked={on} onChange={() => choose(p)} />
            <span className="profile-option-text">
              <b>{p.name}</b>
              <small>{p.builtIn ? 'Template' : `Based on ${TEMPLATES[p.look.template].name}`}</small>
            </span>
            <Swatches look={p.look} />
          </label>
        );
      })}
    </>
  );

  return (
    <section className="hud-panel settings-profiles" aria-labelledby="settings-profiles">
      <h2 id="settings-profiles">Look and feel</h2>
      <p className="settings-hint">
        A profile is a look for the whole interface; every screen works the same in each one. Pick one to load it. Neon Grid is the look OpenMTG was
        designed in, LCARS is a starship console and Reality Fracture is a shattered mirror, card sleeves included; all three are templates: save one as
        a profile of your own to change its colors, text size and backgrounds. Changes are saved at once.
      </p>

      <div className="profile-list" role="radiogroup" aria-labelledby="settings-profiles">
        {group('Templates', all.filter((p) => p.builtIn))}
        {state.profiles.length > 0 && group('My profiles', state.profiles)}
      </div>

      <div className="profile-actions">
        <button type="button" className="button-primary" disabled={full} onClick={() => setMode({ kind: 'saveAs' })}>
          Save as new profile
        </button>
        <button type="button" disabled={active.builtIn} onClick={() => setMode({ kind: 'rename' })}>
          Rename
        </button>
        <button type="button" className="button-danger" disabled={active.builtIn} onClick={() => setMode({ kind: 'delete' })}>
          Delete
        </button>
        <button type="button" onClick={() => setMessage(download(active.name, JSON.stringify(profileFile(active), null, 2)) ? `Exported "${active.name}".` : 'This browser could not save the file.')}>
          Export
        </button>
        <button type="button" disabled={full} onClick={() => file.current?.click()}>
          Import
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void onImport(e)} aria-label="Import a profile file" />
      </div>
      {full && <p className="settings-hint">You have {MAX_PROFILES} profiles, the most there can be; delete one to make another.</p>}

      {mode.kind === 'saveAs' && (
        <NameForm
          label="Name of the new profile"
          initial={active.builtIn ? `My ${active.name}` : `${active.name} copy`}
          submit="Save"
          onCancel={() => setMode({ kind: 'none' })}
          onDone={(name) => {
            const id = store.create(name, active.look);
            setMode({ kind: 'none' });
            setMessage(id ? `Saved and loaded "${store.find(id)!.name}".` : '');
          }}
        />
      )}
      {mode.kind === 'rename' && !active.builtIn && (
        <NameForm
          label="New name"
          initial={active.name}
          submit="Save name"
          onCancel={() => setMode({ kind: 'none' })}
          onDone={(name) => {
            store.rename(active.id, name);
            setMode({ kind: 'none' });
          }}
        />
      )}
      {mode.kind === 'delete' && !active.builtIn && (
        <div className="profile-confirm" role="alertdialog" aria-label={`Delete ${active.name}?`}>
          <p>
            Delete the profile &quot;{active.name}&quot;? The {TEMPLATES[active.look.template].name} template takes its place.
          </p>
          <button
            type="button"
            className="button-danger"
            onClick={() => {
              const name = active.name;
              store.remove(active.id);
              setMode({ kind: 'none' });
              setMessage(`Deleted "${name}".`);
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => setMode({ kind: 'none' })}>
            Cancel
          </button>
        </div>
      )}
      <p className="profile-message" role="status">
        {message}
      </p>
      {!store.persisted && (
        <p className="settings-warning" role="alert">
          This browser does not let OpenMTG store profiles; the look applies until the page is closed.
        </p>
      )}

      {active.builtIn ? (
        <p className="settings-hint profile-locked">
          {active.name} is a template and cannot be changed. Save it as a new profile to customize its colors, text size and backgrounds.
        </p>
      ) : (
        <Customize profile={active} store={store} />
      )}
    </section>
  );
}
