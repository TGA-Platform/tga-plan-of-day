
        {/* ISS — Inclusion Support Staff */}
        {loading ? (
          <div className="rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
            <SkeletonPulse className="h-5 w-40 mb-3" />
            <SkeletonPulse className="h-8 w-full mb-2" />
            <SkeletonPulse className="h-8 w-3/4" />
          </div>
        ) : issStaff.length > 0 && (
          <div
            className="rounded-2xl border shadow-sm overflow-hidden"
            style={{ borderColor: dropTarget === 'iss' ? '#3b82f6' : '#dbeafe', backgroundColor: 'white', borderWidth: dropTarget === 'iss' ? 2 : 1, borderStyle: dropTarget === 'iss' ? 'dashed' : 'solid' }}
            onDragOver={e => onDragOver(e, 'iss')}
            onDragLeave={onDragLeave}
            onDrop={e => onDrop(e, 'iss')}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#eff6ff' }}>
              <div>
                <div className="font-bold text-sm" style={{ color: '#1d4ed8' }}>Support Staff (ISS)</div>
                <div className="text-xs mt-0.5" style={{ color: '#3b82f6' }}>
                  {effectiveIssStaff.length} available{issAsFloats.length > 0 && ` · ${issAsFloats.length} in float pool`}
                </div>
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>ISS</span>
            </div>
            <div className="px-4 pt-2 pb-1">
              <p className="text-xs" style={{ color: '#64748b' }}>
                Drag to a <strong>room</strong> to count toward ratio, drag to <strong>Float Pool</strong> to use as cover, or use the dropdown.
              </p>
            </div>
            <div className="px-4 pb-3 space-y-1.5 mt-1">
              {effectiveIssStaff.length === 0 && issAsFloats.length === 0 ? (
                <p className="text-xs italic" style={{ color: '#94a3b8' }}>All ISS assigned</p>
              ) : effectiveIssStaff.map(s => (
                <div
                  key={s.employeeId + '-' + s.startTime + '-iss'}
                  draggable
                  onDragStart={e => onDragStart(e, s, 'iss')}
                  className="flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing"
                >
                  <StaffChip staff={s} />
                  <select
                    value="iss"
                    onChange={e => {
                      const val = e.target.value;
                      if (val === 'iss') {
                        const next = { ...staffMoves };
                        delete next[s.employeeId];
                        setStaffMoves(next);
                      } else {
                        setStaffMoves(prev => ({ ...prev, [s.employeeId]: val }));
                      }
                    }}
                    className="text-xs rounded-lg border px-1.5 py-1 shrink-0"
                    style={{ borderColor: '#dbeafe', color: '#1d4ed8', backgroundColor: 'white', maxWidth: '110px' }}
                  >
                    <option value="iss">ISS pool</option>
                    <option value="float">Float pool</option>
                    {centre.rooms.map(r => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>
              ))}
              {issAsFloats.length > 0 && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: '#e0e7ff' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: '#6366f1' }}>In float pool:</p>
                  {issAsFloats.map(s => (
                    <div key={s.employeeId + '-fp'} className="flex items-center justify-between gap-2">
                      <StaffChip staff={s} />
                      <button
                        onClick={() => {
                          const next = { ...staffMoves };
                          delete next[s.employeeId];
                          setStaffMoves(next);
                        }}
                        className="text-xs px-2 py-0.5 rounded-lg border"
                        style={{ borderColor: '#dbeafe', color: '#6366f1' }}
                      >
                        Return
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
