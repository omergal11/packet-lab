// The two packet kinds that flow through the simulated network.
// DATA travels from sender to receiver; ACK travels back.
export type PacketKind = 'DATA' | 'ACK';

export interface Packet {
  kind: PacketKind;
  seq: number;
  payload?: string; // DATA packets carry application data; ACKs do not
}

// Every interesting event during a simulation run is recorded as a LogEntry
// so the UI can later replay the run step by step.
export type LogKind =
  | 'send' // sender first transmits a packet
  | 'drop' // link decides to discard the packet
  | 'deliver' // receiver hands a new packet to the application
  | 'ack' // receiver sends an ACK
  | 'timeout' // sender's retransmit timer fires
  | 'retransmit' // sender re-sends the packet after a timeout
  | 'duplicate-dropped'; // receiver silently discards a duplicate

export interface LogEntry {
  time: number; // virtual clock value in milliseconds
  kind: LogKind;
  packet: Packet;
}
