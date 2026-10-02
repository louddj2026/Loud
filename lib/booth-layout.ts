export const BOOTH_LAYOUT_VERSION = 1;
export const DEFAULT_BOOTH_GRID_COLUMNS = 12;

export type BoothControlKind = "button" | "slider" | "option" | "link";

export type BoothControlDefinition = {
  id: string;
  label: string;
  kind: BoothControlKind;
  moduleId: string;
  defaultVisible?: boolean;
  required?: boolean;
};

export type BoothModulePlacement = {
  moduleId: string;
  zone: string;
  column: number;
  row: number;
  span: number;
  rowSpan: number;
};

export type BoothModuleDefinition = {
  id: string;
  label: string;
  controlIds: readonly string[];
  defaultPlacement: BoothModulePlacement;
  allowedZones: readonly string[];
  minSpan?: number;
  maxSpan?: number;
  linked?: boolean;
};

export type BoothLayoutProfile = {
  version: typeof BOOTH_LAYOUT_VERSION;
  id: string;
  name: string;
  placements: BoothModulePlacement[];
  hiddenControlIds: string[];
  lockedModuleIds: string[];
};

export type BoothDropBounds = {
  left: number;
  top: number;
  width: number;
  rowHeight: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const whole = (value: number, fallback = 0) =>
  Number.isFinite(value) ? Math.round(value) : fallback;

export function placementsOverlap(left: BoothModulePlacement, right: BoothModulePlacement) {
  if (left.zone !== right.zone || left.moduleId === right.moduleId) return false;
  return left.column < right.column + right.span
    && left.column + left.span > right.column
    && left.row < right.row + right.rowSpan
    && left.row + left.rowSpan > right.row;
}

export function normaliseBoothPlacement(
  placement: BoothModulePlacement,
  columns = DEFAULT_BOOTH_GRID_COLUMNS,
  definition?: BoothModuleDefinition,
): BoothModulePlacement {
  const safeColumns = Math.max(1, whole(columns, DEFAULT_BOOTH_GRID_COLUMNS));
  const minimumSpan = clamp(whole(definition?.minSpan ?? 1, 1), 1, safeColumns);
  const maximumSpan = clamp(whole(definition?.maxSpan ?? safeColumns, safeColumns), minimumSpan, safeColumns);
  const span = clamp(whole(placement.span, minimumSpan), minimumSpan, maximumSpan);
  return {
    ...placement,
    column: clamp(whole(placement.column), 0, safeColumns - span),
    row: Math.max(0, whole(placement.row)),
    span,
    rowSpan: Math.max(1, whole(placement.rowSpan, 1)),
  };
}

export function nearestOpenBoothPlacement(
  requested: BoothModulePlacement,
  occupied: readonly BoothModulePlacement[],
  columns = DEFAULT_BOOTH_GRID_COLUMNS,
  definition?: BoothModuleDefinition,
) {
  const target = normaliseBoothPlacement(requested, columns, definition);
  const otherPlacements = occupied.filter((placement) => placement.moduleId !== target.moduleId);
  if (!otherPlacements.some((placement) => placementsOverlap(target, placement))) return target;

  const lastOccupiedRow = otherPlacements.reduce(
    (maximum, placement) => Math.max(maximum, placement.row + placement.rowSpan),
    0,
  );
  const lastSearchRow = Math.max(target.row + 8, lastOccupiedRow + 4);
  const candidates: BoothModulePlacement[] = [];

  for (let row = 0; row <= lastSearchRow; row += 1) {
    for (let column = 0; column <= columns - target.span; column += 1) {
      candidates.push({ ...target, column, row });
    }
  }

  candidates.sort((left, right) => {
    const leftDistance = (left.row - target.row) ** 2 + (left.column - target.column) ** 2;
    const rightDistance = (right.row - target.row) ** 2 + (right.column - target.column) ** 2;
    return leftDistance - rightDistance || left.row - right.row || left.column - right.column;
  });

  return candidates.find((candidate) =>
    !otherPlacements.some((placement) => placementsOverlap(candidate, placement))
  ) ?? { ...target, row: lastSearchRow + 1 };
}

export function magneticBoothTarget({
  moduleId,
  zone,
  pointerX,
  pointerY,
  bounds,
  span,
  rowSpan = 1,
  columns = DEFAULT_BOOTH_GRID_COLUMNS,
  grabOffsetX,
  grabOffsetY,
}: {
  moduleId: string;
  zone: string;
  pointerX: number;
  pointerY: number;
  bounds: BoothDropBounds;
  span: number;
  rowSpan?: number;
  columns?: number;
  grabOffsetX?: number;
  grabOffsetY?: number;
}) {
  const safeColumns = Math.max(1, whole(columns, DEFAULT_BOOTH_GRID_COLUMNS));
  const safeSpan = clamp(whole(span, 1), 1, safeColumns);
  const safeRowSpan = Math.max(1, whole(rowSpan, 1));
  const cellWidth = Math.max(1, bounds.width) / safeColumns;
  const offsetX = grabOffsetX ?? cellWidth * safeSpan / 2;
  const offsetY = grabOffsetY ?? bounds.rowHeight * safeRowSpan / 2;
  return normaliseBoothPlacement({
    moduleId,
    zone,
    column: Math.round((pointerX - bounds.left - offsetX) / cellWidth),
    row: Math.round((pointerY - bounds.top - offsetY) / Math.max(1, bounds.rowHeight)),
    span: safeSpan,
    rowSpan: safeRowSpan,
  }, safeColumns);
}

export function createBoothLayoutProfile(
  id: string,
  name: string,
  modules: readonly BoothModuleDefinition[],
  controls: readonly BoothControlDefinition[],
  columns = DEFAULT_BOOTH_GRID_COLUMNS,
): BoothLayoutProfile {
  const placements: BoothModulePlacement[] = [];
  for (const module of modules) {
    placements.push(nearestOpenBoothPlacement(
      module.defaultPlacement,
      placements,
      columns,
      module,
    ));
  }
  return {
    version: BOOTH_LAYOUT_VERSION,
    id,
    name,
    placements,
    hiddenControlIds: controls
      .filter((control) => control.defaultVisible === false && !control.required)
      .map((control) => control.id),
    lockedModuleIds: [],
  };
}

export function sanitiseBoothLayoutProfile(
  profile: Partial<BoothLayoutProfile> | null | undefined,
  modules: readonly BoothModuleDefinition[],
  controls: readonly BoothControlDefinition[],
  columns = DEFAULT_BOOTH_GRID_COLUMNS,
): BoothLayoutProfile {
  const fallback = createBoothLayoutProfile(
    profile?.id || "default",
    profile?.name || "My booth",
    modules,
    controls,
    columns,
  );
  if (!profile) return fallback;

  const suppliedPlacements = new Map(
    (profile.placements ?? []).map((placement) => [placement.moduleId, placement]),
  );
  const placements: BoothModulePlacement[] = [];
  for (const module of modules) {
    const supplied = suppliedPlacements.get(module.id);
    const requested = supplied && module.allowedZones.includes(supplied.zone)
      ? supplied
      : module.defaultPlacement;
    placements.push(nearestOpenBoothPlacement(requested, placements, columns, module));
  }

  const knownControls = new Map(controls.map((control) => [control.id, control]));
  const knownModules = new Set(modules.map((module) => module.id));
  return {
    version: BOOTH_LAYOUT_VERSION,
    id: profile.id || fallback.id,
    name: profile.name || fallback.name,
    placements,
    hiddenControlIds: [...new Set(profile.hiddenControlIds ?? [])]
      .filter((id) => knownControls.has(id) && !knownControls.get(id)?.required),
    lockedModuleIds: [...new Set(profile.lockedModuleIds ?? [])]
      .filter((id) => knownModules.has(id)),
  };
}

export function moveBoothModule(
  profile: BoothLayoutProfile,
  moduleId: string,
  requested: Omit<BoothModulePlacement, "moduleId">,
  modules: readonly BoothModuleDefinition[],
  columns = DEFAULT_BOOTH_GRID_COLUMNS,
) {
  const definition = modules.find((module) => module.id === moduleId);
  if (!definition) throw new Error(`Unknown booth module: ${moduleId}`);
  if (profile.lockedModuleIds.includes(moduleId)) return profile;
  if (!definition.allowedZones.includes(requested.zone)) return profile;

  const placement = nearestOpenBoothPlacement(
    { ...requested, moduleId },
    profile.placements,
    columns,
    definition,
  );
  return {
    ...profile,
    placements: profile.placements.map((current) =>
      current.moduleId === moduleId ? placement : current
    ),
  };
}

export function setBoothControlVisible(
  profile: BoothLayoutProfile,
  controlId: string,
  visible: boolean,
  controls: readonly BoothControlDefinition[],
) {
  const definition = controls.find((control) => control.id === controlId);
  if (!definition) throw new Error(`Unknown booth control: ${controlId}`);
  if (definition.required && !visible) return profile;
  const hidden = new Set(profile.hiddenControlIds);
  if (visible) hidden.delete(controlId);
  else hidden.add(controlId);
  return { ...profile, hiddenControlIds: [...hidden] };
}

export function setBoothModuleVisible(
  profile: BoothLayoutProfile,
  moduleId: string,
  visible: boolean,
  modules: readonly BoothModuleDefinition[],
  controls: readonly BoothControlDefinition[],
) {
  const module = modules.find((candidate) => candidate.id === moduleId);
  if (!module) throw new Error(`Unknown booth module: ${moduleId}`);
  return module.controlIds.reduce(
    (current, controlId) => setBoothControlVisible(current, controlId, visible, controls),
    profile,
  );
}

export function visibleBoothControls(
  profile: BoothLayoutProfile,
  moduleId: string,
  modules: readonly BoothModuleDefinition[],
) {
  const module = modules.find((candidate) => candidate.id === moduleId);
  if (!module) return [];
  const hidden = new Set(profile.hiddenControlIds);
  return module.controlIds.filter((controlId) => !hidden.has(controlId));
}

