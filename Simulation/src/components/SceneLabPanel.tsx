import React from 'react';
import {
  LabSceneObject,
  LightingPreset,
  ScenarioId,
  SelectableTarget,
} from '../types/simulator';
import { SCENARIO_PRESETS } from '../simulation/initialState';
import { getObstacleLocalDimensions } from '../simulation/collision';
import {
  AlertCircle,
  Box,
  Cylinder,
  Mountain,
  RotateCcw,
  SquareStack,
  Sun,
  Trash2,
  Triangle,
  UserPlus,
  Wrench,
} from 'lucide-react';

interface SceneLabPanelProps {
  labObjects: LabSceneObject[];
  collidingIds: string[];
  detectedObstacleIds: string[];
  activeScenario: ScenarioId;
  onSelectScenario: (id: ScenarioId) => void;
  onResetScenario: () => void;
  selectedTarget: SelectableTarget;
  onSelectTarget: (target: SelectableTarget) => void;
  onSpawnLabObject: (type: LabSceneObject['type']) => void;
  onUpdateLabObject: (id: string, patch: Partial<LabSceneObject>) => void;
  onDeleteLabObject: (id: string) => void;
  attachmentMode: boolean;
  onToggleAttachmentMode: () => void;
  lightingPreset: LightingPreset;
  onChangeLightingPreset: (preset: LightingPreset) => void;
  lightIntensity: number;
  onChangeLightIntensity: (val: number) => void;
  shadowsEnabled: boolean;
  onToggleShadows: (enabled: boolean) => void;
}

export const SceneLabPanel: React.FC<SceneLabPanelProps> = ({
  labObjects,
  collidingIds,
  detectedObstacleIds,
  activeScenario,
  onSelectScenario,
  onResetScenario,
  selectedTarget,
  onSelectTarget,
  onSpawnLabObject,
  onUpdateLabObject,
  onDeleteLabObject,
  attachmentMode,
  onToggleAttachmentMode,
  lightingPreset,
  onChangeLightingPreset,
  lightIntensity,
  onChangeLightIntensity,
  shadowsEnabled,
  onToggleShadows,
}) => {
  const selectedSceneObj =
    selectedTarget?.kind === 'scene-object'
      ? labObjects.find((o) => o.id === selectedTarget.objectId) ?? null
      : null;

  const scenarioOrder: ScenarioId[] = [
    'default-lab',
    'single-box',
    'wall-one-side',
    'wall-right-side',
    'either-side-bypass',
    'blocked-corridor',
  ];

  return (
    <div className="space-y-5 text-sm">
      {/* Test Scenarios & Scene Reset */}
      <section className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white">
            Obstacle Avoidance Scenarios
          </span>
          <button
            type="button"
            onClick={onResetScenario}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3 text-sky-400" /> Reset Positions
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {scenarioOrder.map((scId) => {
            const sc = SCENARIO_PRESETS[scId];
            return (
              <button
                key={scId}
                type="button"
                onClick={() => onSelectScenario(scId)}
                className={`px-2 py-1.5 rounded text-xs text-left border transition-colors cursor-pointer ${
                  activeScenario === scId
                    ? 'bg-blue-600/25 border-blue-500 text-white font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                {sc.title}
              </button>
            );
          })}
        </div>
      </section>

      {/* Component Attachment Mode */}
      <section className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            Component Attachment Mode
          </span>
          <button
            type="button"
            onClick={onToggleAttachmentMode}
            className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
              attachmentMode
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {attachmentMode ? 'Active' : 'Enable'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Isolates selection to KUKUR&apos;s Camera, LCD Display, and Microphone so you can drag or
          rotate their mounting positions without moving the robot chassis.
        </p>
      </section>

      {/* Spawn People & Solid Lab Obstacles */}
      <section className="space-y-2.5">
        <h3 className="text-sm font-semibold text-white">Add Solid Lab Obstacles & Surfaces</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSpawnLabObject('wall')}
            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <SquareStack className="w-4 h-4 text-rose-400 shrink-0" /> Solid Barrier Wall
          </button>
          <button
            type="button"
            onClick={() => onSpawnLabObject('box')}
            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <Box className="w-4 h-4 text-amber-400 shrink-0" /> Calibration Box
          </button>
          <button
            type="button"
            onClick={() => onSpawnLabObject('cylinder')}
            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <Cylinder className="w-4 h-4 text-teal-400 shrink-0" /> Pillar Cylinder
          </button>
          <button
            type="button"
            onClick={() => onSpawnLabObject('human')}
            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <UserPlus className="w-4 h-4 text-sky-400 shrink-0" /> Movable Person
          </button>
          <button
            type="button"
            onClick={() => onSpawnLabObject('ramp')}
            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <Triangle className="w-4 h-4 text-indigo-400 shrink-0" /> Incline Ramp
          </button>
          <button
            type="button"
            onClick={() => onSpawnLabObject('rough-terrain')}
            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <Mountain className="w-4 h-4 text-stone-400 shrink-0" /> Terrain Pad (Floor)
          </button>
        </div>
      </section>

      {/* Collision Alert Banner */}
      {collidingIds.length > 0 && (
        <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/50 text-xs text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>
            Solid contact boundary reached with:{' '}
            <strong className="font-mono">{collidingIds.join(', ')}</strong>
          </span>
        </div>
      )}

      {/* Selected Lab Object Transform Controls */}
      {selectedSceneObj && (
        <section className="p-3 rounded-lg bg-sky-950/25 border border-sky-500/50 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-white">{selectedSceneObj.label}</h4>
              <span className="text-[11px] font-mono text-sky-300">
                ID: {selectedSceneObj.id} ·{' '}
                {getObstacleLocalDimensions(selectedSceneObj.type).isSolid
                  ? 'SOLID COLLIDER'
                  : 'NON-BLOCKING FLOOR'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onDeleteLabObject(selectedSceneObj.id)}
              className="px-2 py-1 rounded bg-red-950/80 hover:bg-red-900 text-red-200 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>

          {[
            {
              label: 'Position X (m)',
              val: selectedSceneObj.position[0],
              min: -4.5,
              max: 4.5,
              step: 0.05,
              onChange: (v: number) =>
                onUpdateLabObject(selectedSceneObj.id, {
                  position: [v, selectedSceneObj.position[1], selectedSceneObj.position[2]],
                }),
            },
            {
              label: 'Position Z (m)',
              val: selectedSceneObj.position[2],
              min: -4.5,
              max: 4.5,
              step: 0.05,
              onChange: (v: number) =>
                onUpdateLabObject(selectedSceneObj.id, {
                  position: [selectedSceneObj.position[0], selectedSceneObj.position[1], v],
                }),
            },
            {
              label: 'Heading Rotation Y (°)',
              val: selectedSceneObj.rotation[1],
              min: -180,
              max: 180,
              step: 5,
              onChange: (v: number) =>
                onUpdateLabObject(selectedSceneObj.id, {
                  rotation: [selectedSceneObj.rotation[0], v, selectedSceneObj.rotation[2]],
                }),
            },
            {
              label: 'Uniform Scale',
              val: selectedSceneObj.scale[0],
              min: 0.4,
              max: 2.2,
              step: 0.05,
              onChange: (v: number) =>
                onUpdateLabObject(selectedSceneObj.id, {
                  scale: [v, v, v],
                }),
            },
          ].map((ctrl) => (
            <div key={ctrl.label} className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">{ctrl.label}</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {ctrl.val.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={ctrl.min}
                max={ctrl.max}
                step={ctrl.step}
                value={ctrl.val}
                onChange={(e) => ctrl.onChange(parseFloat(e.target.value))}
                className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          ))}
        </section>
      )}

      {/* Scene Object Roster */}
      <section className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Active Lab Objects ({labObjects.length})</span>
          <span>Click to Select / Edit</span>
        </div>

        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {labObjects.map((obj) => {
            const isSel =
              selectedTarget?.kind === 'scene-object' && selectedTarget.objectId === obj.id;
            const isCol = collidingIds.includes(obj.id);
            const isDet = detectedObstacleIds.includes(obj.id);
            const isSolid = getObstacleLocalDimensions(obj.type).isSolid;
            return (
              <div
                key={obj.id}
                onClick={() => onSelectTarget({ kind: 'scene-object', objectId: obj.id })}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-pointer transition-colors ${
                  isSel
                    ? 'bg-sky-950/40 border-sky-500/70 text-white'
                    : isCol
                    ? 'bg-red-950/40 border-red-500/50 text-red-200'
                    : isDet
                    ? 'bg-amber-950/30 border-amber-500/40 text-amber-100'
                    : 'bg-slate-900 border-slate-800 text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="truncate">
                  <span className="font-medium">{obj.label}</span>
                  <span className="text-[10px] font-mono text-slate-400 ml-2 tabular-nums">
                    ({obj.position[0].toFixed(1)}, {obj.position[2].toFixed(1)}m){' '}
                    {isSolid ? '· SOLID' : '· FLOOR'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteLabObject(obj.id);
                  }}
                  className="text-slate-400 hover:text-red-400 p-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Lab Lighting & Shadows */}
      <section className="pt-4 border-t border-slate-800/80 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          Laboratory Lighting & Shadows
        </h3>

        <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['studio', 'daylight', 'inspection'] as LightingPreset[]).map((lp) => (
            <button
              key={lp}
              type="button"
              onClick={() => onChangeLightingPreset(lp)}
              className={`py-1.5 rounded text-xs font-medium capitalize cursor-pointer ${
                lightingPreset === lp
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {lp}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300">Illumination Intensity</span>
            <span className="font-mono text-slate-200 tabular-nums">
              {(lightIntensity * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.05}
            value={lightIntensity}
            onChange={(e) => onChangeLightIntensity(parseFloat(e.target.value))}
            className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
        </div>

        <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
          <span>Enable Soft Shadows</span>
          <input
            type="checkbox"
            checked={shadowsEnabled}
            onChange={(e) => onToggleShadows(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
          />
        </label>
      </section>
    </div>
  );
};
