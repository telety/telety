export interface Message {
  id: string;
  created?: string;
  input: string;
  meta: string;
}

export function messageIdHash(message: Message): string {
  let hash = 0;
  const str = message.id;
  if (!str){
    return '' + hash;
  }
  for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
  }
  return hash.toString().slice(-4);
}