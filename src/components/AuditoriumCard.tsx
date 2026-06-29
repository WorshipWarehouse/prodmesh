import type { Auditorium } from '../types';
import { Tile } from './Tile';

export function AuditoriumCard({ auditorium }: { auditorium: Auditorium }) {
  return (
    <section className="auditorium">
      <h3 className="auditorium__name">{auditorium.name}</h3>
      <div className="auditorium__tiles">
        {auditorium.tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>
    </section>
  );
}
