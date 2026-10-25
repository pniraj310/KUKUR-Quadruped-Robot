import React, { useState } from 'react';
import { Box, Plus, Trash2, Move, User, Disc, Cone, Layers } from 'lucide-react';
import { EnvironmentType, SceneItem, Vector3D } from '../types/robot';

interface EnvironmentEditorPanelProps {
  envType: EnvironmentType;
  setEnvType: (env: EnvironmentType) => void;
  sceneItems: SceneItem[];
  onAddItem: (item: SceneItem) => void;
  onRemoveItem: (id: string) => void;
  onUpdateItemPos: (id: string, pos: Vector3D) => void;
}

export const EnvironmentEditorPanel: React.FC<EnvironmentEditorPanelProps> = ({
  envType,
  setEnvType,
  sceneItems,
  onAddItem,
  onRemoveItem,
  onUpdateItemPos,
}) => {
  const [selectedItemId, setSelectedItemId] = useState<string>(sceneItems[0]?.id || '');
  const [newType, setNewType] = useState<SceneItem['type']>('box');

  const selectedItem = sceneItems.find((it) => it.id === selectedItemId) || sceneItems[0];

  const handleCreateNew = () => {
    const id = `${newType}-${Date.now().toString().slice(-4)}`;
    const newItem: SceneItem = {
      id,
      type: newType,
      name: `${newType.toUpperCase()} #${sceneItems.length + 1}`,
      position: {
        x: Math.round((Math.random() - 0.5) * 3 * 10) / 10,
        y: 0,
        z: Math.round((1.0 + Math.random() * 2.5) * 10) / 10,
      },
      rotation: 0,
      isWalking: newType === 'person',
    };
    onAddItem(newItem);
    setSelectedItemId(id);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-100">
                Interactive 3D World & Environment Editor
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Dynamic Objects & Person Pacing
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono">
              Add obstacles, adjust mannequin coordinates, and configure terrain
            </div>
          </div>
        </div>

        {/* Add Object Quick Creator */}
        <div className="flex items-center gap-2">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as any)}
            className="px-2.5 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 text-xs font-mono"
          >
            <option value="person">Person (Mannequin)</option>
            <option value="box">Wooden Box / Crate</option>
            <option value="chair">Lab Office Chair</option>
            <option value="pylon">Traffic Safety Pylon</option>
            <option value="barrel">Oil / Water Barrel</option>
          </select>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-lg text-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Spawn Object
          </button>
        </div>
      </div>

      {/* Main Grid: Scene Items List (Left) + Selected Item Position Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3 flex-1 overflow-auto">
        {/* Left: Active Scene Objects List */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
            <span>Scene Objects ({sceneItems.length})</span>
            <span className="text-[10px] text-neutral-500 font-mono">Select to position</span>
          </div>

          <div className="space-y-1.5 overflow-y-auto max-h-[220px]">
            {sceneItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItemId(item.id)}
                className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                  selectedItemId === item.id
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200'
                    : 'bg-neutral-950 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {item.type === 'person' && <User className="w-3.5 h-3.5 text-amber-400" />}
                  {item.type === 'box' && <Box className="w-3.5 h-3.5 text-amber-500" />}
                  {item.type === 'chair' && <Layers className="w-3.5 h-3.5 text-sky-400" />}
                  {item.type === 'pylon' && <Cone className="w-3.5 h-3.5 text-orange-400" />}
                  {item.type === 'barrel' && <Disc className="w-3.5 h-3.5 text-blue-400" />}
                  <div>
                    <div className="font-semibold text-xs text-neutral-100">{item.name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      Pos: [{item.position.x}m, {item.position.z}m]
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(item.id);
                  }}
                  className="p-1 text-neutral-500 hover:text-rose-400 rounded transition"
                  title="Remove from world"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Selected Object Coordinates & Movement */}
        {selectedItem && (
          <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Position Controller: {selectedItem.name}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  {selectedItem.type.toUpperCase()}
                </span>
              </div>

              {/* X coordinate (Lateral) */}
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-neutral-300 font-mono">
                  <span>Lateral Position (X):</span>
                  <span className="text-amber-400 font-bold">{selectedItem.position.x} m</span>
                </div>
                <input
                  type="range"
                  min="-4.0"
                  max="4.0"
                  step="0.1"
                  value={selectedItem.position.x}
                  onChange={(e) =>
                    onUpdateItemPos(selectedItem.id, {
                      ...selectedItem.position,
                      x: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-amber-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
                />
              </div>

              {/* Z coordinate (Forward/Back distance from robot) */}
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-neutral-300 font-mono">
                  <span>Longitudinal Distance (Z):</span>
                  <span className="text-amber-400 font-bold">{selectedItem.position.z} m</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="6.0"
                  step="0.1"
                  value={selectedItem.position.z}
                  onChange={(e) =>
                    onUpdateItemPos(selectedItem.id, {
                      ...selectedItem.position,
                      z: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-amber-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
                />
              </div>

              {selectedItem.type === 'person' && (
                <div className="mt-4 p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-between">
                  <span className="text-neutral-300 text-xs">Pacing / Walking Patrol</span>
                  <button
                    onClick={() => {
                      selectedItem.isWalking = !selectedItem.isWalking;
                      onUpdateItemPos(selectedItem.id, { ...selectedItem.position });
                    }}
                    className={`px-2 py-1 rounded text-xs font-mono font-medium border transition ${
                      selectedItem.isWalking
                        ? 'bg-amber-500 text-neutral-950 font-bold'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                    }`}
                  >
                    {selectedItem.isWalking ? 'WALKING ACTIVE' : 'STATIONARY'}
                  </button>
                </div>
              )}
            </div>

            <div className="text-[10px] text-neutral-500 font-mono">
              Moving objects updates the robot's simulated ultrasonic distance and computer-vision bounding boxes in real time.
            </div>
          </div>
        )}

        {/* Right: Terrain & Ground Selector */}
        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              Terrain & Ground Configuration
            </div>

            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  { id: 'lab', label: '1. Laboratory Test Arena', desc: 'Flat polished metric grid floor' },
                  { id: 'obstacles', label: '2. Step Obstacle Course', desc: '2cm, 4cm, 6cm hurdles & pylons' },
                  { id: 'slopes', label: '3. 15° Ramp Incline', desc: 'Inclined slope for pitch leveling' },
                  { id: 'rough', label: '4. Uneven Rough Terrain', desc: 'Rocky bumps testing foot compliance' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setEnvType(t.id)}
                  className={`p-2.5 rounded-lg border text-left transition ${
                    envType === t.id
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <div className="font-bold text-xs text-neutral-100">{t.label}</div>
                  <div className="text-[10.5px] text-neutral-500 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="text-[10.5px] text-neutral-500 font-mono">
            Ground height profile automatically interacts with KUKUR inverse kinematics.
          </div>
        </div>
      </div>
    </div>
  );
};
