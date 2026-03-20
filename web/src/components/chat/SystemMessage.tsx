interface Props {
  text: string;
}

export function SystemMessage({ text }: Props) {
  return (
    <div className="msgSystem">
      <span>{text}</span>
    </div>
  );
}
