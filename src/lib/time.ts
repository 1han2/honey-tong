export const nowIso = (): string => new Date().toISOString();

export const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};
