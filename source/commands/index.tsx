import { Text } from "ink";
import { z } from "zod";

export const options = z.object({
  name: z.string().default("World").describe("Name to greet"),
});

type Props = {
  options: z.infer<typeof options>;
};

export default function Index({ options }: Props) {
  return <Text>Hello, {options.name}!</Text>;
}
