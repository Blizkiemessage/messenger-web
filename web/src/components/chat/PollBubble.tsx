import { useState } from 'react';
import type { Poll } from '../../types';

interface Props {
  poll: Poll;
  meId: string;
  onVote: (optionIds: string[]) => void;
  onRetract: () => void;
  onViewVoters: (optionId: string) => void;
}

export function PollBubble({ poll, meId: _meId, onVote, onRetract: _onRetract, onViewVoters }: Props) {
  const hasVoted = poll.my_votes.length > 0;
  // Staged selections for multiple-choice polls (before submitting)
  const [staged, setStaged] = useState<string[]>([]);

  const metaText = poll.is_anonymous ? 'Анонимный опрос' : 'Публичный опрос';
  const typeText = poll.is_quiz ? ' · Викторина' : poll.allow_multiple ? ' · Несколько ответов' : '';

  function handleOptionClick(optId: string) {
    if (hasVoted) {
      // Public poll: show voters modal
      if (!poll.is_anonymous) onViewVoters(optId);
      return;
    }
    if (!poll.allow_multiple) {
      // Single choice: vote immediately
      onVote([optId]);
    } else {
      // Multiple choice: stage the selection
      setStaged(prev =>
        prev.includes(optId) ? prev.filter(id => id !== optId) : [...prev, optId]
      );
    }
  }

  function handleMultiVote() {
    if (staged.length === 0) return;
    onVote(staged);
    setStaged([]);
  }

  const showResults = hasVoted;

  return (
    <div className="pollBubble">
      <div className="pollQuestion">{poll.question}</div>
      <div className="pollMeta">{metaText}{typeText}</div>

      <div className="pollOptions">
        {poll.options.map(opt => {
          const isVoted = poll.my_votes.includes(opt.id);
          const isStaged = staged.includes(opt.id);
          const isCorrect = poll.is_quiz && showResults && opt.id === poll.correct_option_id;
          const isWrong = poll.is_quiz && showResults && isVoted && opt.id !== poll.correct_option_id;

          return (
            <div
              key={opt.id}
              className={`pollOption${!hasVoted ? ' pollOptionClickable' : ''}${!poll.is_anonymous && hasVoted ? ' pollOptionPublic' : ''}`}
              onClick={() => handleOptionClick(opt.id)}
            >
              <div className="pollOptionRow">
                {/* Check indicator */}
                <div className={`pollOptionCheck${isVoted || isStaged ? ' checked' : ''}${isCorrect ? ' quizCorrect' : ''}${isWrong ? ' quizWrong' : ''}`}>
                  {/* Wrong answer: red X */}
                  {isWrong && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
                      <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                    </svg>
                  )}
                  {/* Correct answer: green checkmark (always shown after voting) */}
                  {isCorrect && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2 6 5 9 10 3"/>
                    </svg>
                  )}
                  {/* Non-quiz voted option: checkmark */}
                  {!poll.is_quiz && (isVoted || isStaged) && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2 6 5 9 10 3"/>
                    </svg>
                  )}
                </div>

                <span className="pollOptionText">{opt.text}</span>

                {showResults && (
                  <span className="pollOptionPct">{opt.percentage}%</span>
                )}

                {!poll.is_anonymous && hasVoted && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                )}
              </div>

              {showResults && (
                <div className="pollBar">
                  <div
                    className={`pollBarFill${isCorrect ? ' quizCorrect' : ''}`}
                    style={{ width: `${opt.percentage}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Multiple choice submit button */}
      {!hasVoted && poll.allow_multiple && (
        <button
          className="pollVoteBtn"
          onClick={handleMultiVote}
          disabled={staged.length === 0}
        >
          Голосовать
        </button>
      )}

      <div className="pollTotalVotes">
        {poll.total_votes === 0
          ? 'Нет голосов'
          : poll.total_votes === 1
            ? '1 голос'
            : `${poll.total_votes} голосов`}
      </div>
    </div>
  );
}
