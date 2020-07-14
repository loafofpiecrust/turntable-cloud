

export interface Song {
  title: string
  album: string
  artist: string
  albumArtist: string
  duration: number // milliseconds
}

export interface AudioStream {
  url: string,
  format: string,
  bitrate: number,
}

export type SongStreams = {
  id: string,
  highQuality?: AudioStream,
  lowQuality: AudioStream,
  duration: number,
  expiryDate: number,
  lifespan: number,
} | { highQuality: null, lowQuality: null, expiryDate: 0 }


export interface Album {
  title: string,
  type: AlbumType,
  artist?: string,
  label?: string,
  year?: number,
  thumbnailUrl?: string,
}

export type AlbumType = "LP" | "EP" | "Single" | "Other"