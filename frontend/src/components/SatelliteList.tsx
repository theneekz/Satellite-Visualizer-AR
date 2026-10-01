import { useEffect, useRef, type ReactNode } from 'react'
import type { SatelliteInfo } from '../api/satellites'
import './SatelliteList.css'

function SatelliteList({
  satellites,
  totalCount,
  loading,
  selectedId,
  onSelect,
  children,
}: {
  satellites: SatelliteInfo[]
  totalCount: number // size of the unfiltered list
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  children?: ReactNode // search and filter controls, shown above the rows
}) {
  // When a satellite is selected from the globe, bring its row into view.
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <nav className="satellite-list" aria-label="Satellites" aria-busy={loading}>
      <h2 className="satellite-list__title">
        {loading
          ? 'Satellites'
          : satellites.length === totalCount
            ? `Satellites (${totalCount})`
            : `Satellites (${satellites.length} of ${totalCount})`}
      </h2>
      {children}
      {loading ? (
        <p className="satellite-list__message" role="status">
          Loading satellites...
        </p>
      ) : satellites.length === 0 ? (
        <p className="satellite-list__message">
          {totalCount > 0 ? 'No satellites match your filters.' : 'No satellites found.'}
        </p>
      ) : (
        <ul className="satellite-list__items">
          {satellites.map((satellite) => {
            const selected = satellite.id === selectedId
            return (
              <li key={satellite.id}>
                <button
                  type="button"
                  ref={selected ? selectedRef : undefined}
                  className={`satellite-list__item${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(satellite.id)}
                >
                  <span className="satellite-list__name">{satellite.name}</span>
                  <span className="satellite-list__id">{satellite.id}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}

export default SatelliteList
