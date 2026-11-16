export function selectAttemptQuestions(bank, maximum, random = Math.random) {
  const questions = [...new Map(bank.map((question) => [question._id, question])).values()];
  const count = Math.min(maximum ?? questions.length, questions.length);

  for (let index = 0; index < count; index++) {
    const selected = index + Math.floor(random() * (questions.length - index));
    [questions[index], questions[selected]] = [questions[selected], questions[index]];
  }

  return questions.slice(0, count);
}

export function gradeAttempt(questions, answers, maxGrade) {
  let possible = 0;
  let earned = 0;
  let correct = 0;

  for (const question of questions) {
    possible += question.points;
    if (answers[question._id] === question.correctOptionIndex) {
      earned += question.points;
      correct++;
    }
  }

  return {
    grade: possible ? Number(((earned / possible) * maxGrade).toFixed(2)) : 0,
    correct,
  };
}
