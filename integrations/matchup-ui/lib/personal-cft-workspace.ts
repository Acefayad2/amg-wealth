type OwnedTrainer = { id: string; user_id: string | null };
type TrainerRecord = { trainer_id: string };

export function personalCftWorkspace<T extends OwnedTrainer, A extends TrainerRecord, S extends TrainerRecord>(
  userId: string, data: { trainers: T[]; appointments: A[]; slots: S[] },
) {
  const trainers = data.trainers.filter(trainer => trainer.user_id === userId);
  const ownIds = new Set(trainers.map(trainer => trainer.id));
  return {
    trainers,
    appointments: data.appointments.filter(item => ownIds.has(item.trainer_id)),
    slots: data.slots.filter(item => ownIds.has(item.trainer_id)),
  };
}
