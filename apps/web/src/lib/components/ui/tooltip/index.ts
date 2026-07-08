import { Tooltip as TooltipPrimitive } from 'bits-ui';
import Content from './tooltip-content.svelte';

const Root = TooltipPrimitive.Root;
const Trigger = TooltipPrimitive.Trigger;
const Provider = TooltipPrimitive.Provider;

export { Root, Trigger, Provider, Content };
export {
	Root as Tooltip,
	Trigger as TooltipTrigger,
	Provider as TooltipProvider,
	Content as TooltipContent
};
