import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ChevronRight,
  CornerDownRight,
  CornerLeftUp,
  Folder,
  FolderOpen,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { FOLDERS } from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import {
  browsable,
  folderName,
  homePath,
  isOutdated,
  OUTDATED_BRIDGE,
  typedPath,
} from '@/lib/sessions';
import type { FolderListing } from '@/lib/types';
import { Button, c, Field, Loading, Notice, s } from '@/components/ui';

/** Rows drawn at once; typing narrows the rest. */
const SHOWN = 200;

function Row({
  icon,
  label,
  detail,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.item,
        s.row,
        { paddingVertical: 10 },
        pressed && s.selected,
      ]}
    >
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={s.body}>
          {label}
        </Text>
        {!!detail && (
          <Text numberOfLines={1} ellipsizeMode="middle" style={s.eyebrow}>
            {detail}
          </Text>
        )}
      </View>
      <ChevronRight size={16} color={c.dim} />
    </Pressable>
  );
}

/** A chosen folder: its real path, and how to show it. */
export type ChosenFolder = { path: string; home: boolean; label: string };

/**
 * Any folder on the computer, browsed from the home folder by name (the
 * bridge never sends files). Nothing is stored: each listing is fetched
 * fresh and kept only while the sheet is open.
 */
export function FolderBrowser({
  onChoose,
}: {
  onChoose: (folder: ChosenFolder) => void;
}) {
  const { client, activeMachine } = useSession();
  const [listing, setListing] = useState<FolderListing | null>(null);
  // The home folder's real path, from the first listing: only it shows as ~.
  const [home, setHome] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  // Only the last folder asked for may replace the listing.
  const latest = useRef(0);

  const open = useCallback(
    (path: string | null) => {
      if (!client) return;
      const request = ++latest.current;
      setBusy(true);
      setError('');
      client
        .query<{ folders: FolderListing }>({
          query: FOLDERS,
          variables: { path },
          fetchPolicy: 'no-cache',
        })
        .then((result) => {
          if (!alive.current || request !== latest.current) return;
          if (!result.data) throw new Error('No folders returned.');
          if (path === null) setHome(result.data.folders.path);
          setListing(result.data.folders);
          setText('');
          setBusy(false);
        })
        .catch((reason: unknown) => {
          if (!alive.current || request !== latest.current) return;
          setError(isOutdated(reason) ? OUTDATED_BRIDGE : errorMessage(reason));
          setBusy(false);
        });
    },
    [client],
  );
  useEffect(() => {
    alive.current = true;
    open(null);
    return () => {
      alive.current = false;
    };
  }, [open]);

  const path = typedPath(text);
  const { shown, hidden } = listing
    ? browsable(listing.folders, text)
    : { shown: [], hidden: 0 };
  const here = listing ? homePath(listing.path, home) : '';
  const atHome = !!listing && listing.path === home;

  return (
    <>
      <Text style={s.muted}>
        Folders on {activeMachine?.name ?? 'your computer'}. Open one and use
        it: the session gets its own Herdr workspace there, or a new tab if the
        folder is already open as a project.
      </Text>
      {!listing && busy && (
        <View style={{ height: 120 }}>
          <Loading label="reading folders…" />
        </View>
      )}
      {listing && (
        <>
          <View style={[s.item, s.row, s.selected, { paddingVertical: 10 }]}>
            <FolderOpen size={16} color={c.accent} />
            <Text
              numberOfLines={1}
              ellipsizeMode="head"
              style={[s.body, { flex: 1, fontWeight: '700' }]}
            >
              {here}
            </Text>
          </View>
          <Button
            title={`use ${atHome ? 'home folder' : folderName(listing.path)}`}
            accessibilityLabel={`Use ${here}`}
            disabled={busy}
            onPress={() =>
              onChoose({ path: listing.path, home: atHome, label: here })
            }
          />
        </>
      )}
      {/* Also when the first listing failed: a typed path still works. */}
      {(listing || !busy) && (
        <Field
          placeholder="find a folder, or type a path"
          accessibilityLabel="Find a folder or type a path"
          value={text}
          onChangeText={setText}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (path) open(path);
          }}
        />
      )}
      {!!error && <Notice message={error} danger />}
      {path ? (
        <Row
          icon={<CornerDownRight size={16} color={c.accent} />}
          label={`go to ${path}`}
          accessibilityLabel={`Go to ${path}`}
          disabled={busy}
          onPress={() => open(path)}
        />
      ) : listing ? (
        <View style={{ gap: 2, opacity: busy ? 0.5 : 1 }}>
          {listing.parent && (
            <Row
              icon={<CornerLeftUp size={16} color={c.accent} />}
              label=".."
              detail={homePath(listing.parent, home)}
              accessibilityLabel={`Up to ${homePath(listing.parent, home)}`}
              disabled={busy}
              onPress={() => open(listing.parent)}
            />
          )}
          {shown.slice(0, SHOWN).map((folder) => (
            <Row
              key={folder.path}
              icon={<Folder size={16} color={c.accent} />}
              label={folder.name}
              accessibilityLabel={`Open ${folder.name}`}
              disabled={busy}
              onPress={() => open(folder.path)}
            />
          ))}
          {shown.length > SHOWN && (
            <Text style={s.muted}>
              {shown.length - SHOWN} more: type to narrow the list.
            </Text>
          )}
          {!shown.length && (
            <Text style={s.muted}>
              {text.trim() ? 'No folder here matches.' : 'No folders here.'}
            </Text>
          )}
          {listing.truncated && (
            <Text style={s.muted}>
              Not every folder here is listed. Type a path to go to one that is
              missing.
            </Text>
          )}
          {!!hidden && (
            <Text style={s.muted}>
              {hidden} hidden {hidden === 1 ? 'folder' : 'folders'}: type . to
              show them.
            </Text>
          )}
        </View>
      ) : (
        !busy && (
          <Button
            title="try again"
            accessibilityLabel="Read the home folder again"
            variant="secondary"
            onPress={() => open(null)}
          />
        )
      )}
    </>
  );
}
