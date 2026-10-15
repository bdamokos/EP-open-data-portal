export function transcriptLanguage(xml: string | null): {
  tags: string[];
  machine: boolean;
  originalLanguage: string | null;
};
