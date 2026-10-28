// The two packet kinds that flow through the simulated network.
// DATA travels from sender to receiver; ACK travels back.
export type PacketKind = 'DATA' | 'ACK';

export interface Packet {
  readonly kind: PacketKind;
  readonly seq: number;
  readonly payload?: string; // DATA packets carry application data; ACKs do not
}

// Wire events are logged by the Simulation itself, never by a protocol.
// That way every protocol gets a complete, consistent record of what the link did.
export type WireLogKind =
  | 'send' // an endpoint puts a packet (DATA or ACK) on the link for the first time
  | 'retransmit' // the sender re-sends a DATA packet after a timeout
  | 'link-duplicate' // the link itself created an extra copy (not the sender's doing)
  | 'drop' // the link lost this copy; logged at the point on the wire where it was lost
  | 'data-received' // a DATA copy reached the receiver
  | 'ack-received'; // an ACK copy reached the sender

// Protocol events describe what an endpoint decided to do.
export type ProtocolLogKind =
  | 'timeout' // a retransmission timer fired
  | 'deliver' // the receiver handed a packet to the application (in order, exactly once)
  | 'buffer' // the receiver stored an out-of-order packet for later delivery
  | 'duplicate-dropped' // the receiver discarded a packet it already had
  | 'out-of-order-dropped'; // the receiver discarded a packet that arrived too early (Go-Back-N)

export type LogKind = WireLogKind | ProtocolLogKind;

// Every interesting event during a simulation run is recorded as a LogEntry
// so the UI can later replay the run step by step.
export interface LogEntry {
  readonly time: number; // virtual clock value in milliseconds
  readonly kind: LogKind;
  readonly packet: Packet; // packet.kind tells DATA and ACK apart in every entry
  // Identifies one physical copy on the wire. Present on wire events only.
  // Needed because one seq can have several copies in flight (retransmissions, link
  // duplicates), and the replay must match each departure to its own arrival or drop.
  readonly wireId?: number;
}
