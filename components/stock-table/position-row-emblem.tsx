import {
    Anvil, Atom, BatteryCharging, Bitcoin, Boxes, BrainCircuit, Building2, Cable,
    ChartNoAxesCombined, CircleDot, CircleHelp, Code2, Coins, Construction, Container,
    Cpu, Cylinder, Diamond, Dice5, Disc3, Dna, Drill, Droplets, Factory, Flame,
    FlaskConical, Folder, Fuel, Gamepad2, Gem, Globe2, GraduationCap, HardHat,
    HeartPulse, Hospital, House, Landmark, Layers2, Layers3, Leaf, Magnet, Microscope,
    Mountain, MountainSnow, Network, Newspaper, Package, Pickaxe, Pill, Plane,
    RadioTower, Rocket, ScrollText, Server, Shield, ShieldCheck, Ship, ShoppingBasket,
    ShoppingCart, Stethoscope, Sun, TrainFront, Trees, Truck, Utensils, UtilityPole,
    Vault, Wallet, Waves, Wheat, Wind, Wrench, CircuitBoard, Triangle, type LucideIcon,
} from 'lucide-react';
import { assetClassColourKey } from '@/lib/asset-class-identity';
import { ROW_ICON_CATALOGUE, rowIconForClass, type RowEmblem } from '@/lib/position-row-appearance';

const ICON_COMPONENTS: Record<RowEmblem, LucideIcon> = {
    none: Triangle, auto: Layers3, gem: Gem, mining: Pickaxe, energy: Flame, health: Stethoscope,
    technology: CircuitBoard, finance: Landmark, industry: Building2, agriculture: Wheat, defence: Shield, global: Globe2,
    gold: Coins, 'gold-bullion': Vault, silver: CircleDot, 'silver-bullion': Disc3, platinum: Diamond,
    copper: Cable, 'base-metals': Boxes, lithium: BatteryCharging, uranium: Atom, 'rare-earths': Magnet,
    'iron-ore': Mountain, 'diversified-miners': MountainSnow, aluminium: Layers2, chemicals: FlaskConical,
    forestry: Trees, steel: Anvil, 'mining-services': Wrench, oil: Fuel, 'energy-commodities': Droplets,
    'oil-services': Drill, gas: Cylinder, commodities: Container, solar: Sun, wind: Wind, renewables: Leaf,
    insurance: ShieldCheck, bonds: ScrollText, cash: Wallet, 'broad-equity': ChartNoAxesCombined, 'real-estate': House,
    semiconductors: Cpu, platforms: Network, software: Code2, crypto: Bitcoin, 'data-centres': Server,
    telecom: RadioTower, ai: BrainCircuit, medtech: HeartPulse, pharma: Pill, biotech: Dna,
    research: Microscope, hospital: Hospital, industrials: Factory, construction: HardHat, logistics: Truck,
    aerospace: Plane, infrastructure: Construction, utilities: UtilityPole, shipping: Ship, rail: TrainFront,
    space: Rocket, staples: ShoppingBasket, retail: ShoppingCart, gambling: Dice5, gaming: Gamepad2,
    education: GraduationCap, media: Newspaper, packaging: Package, food: Utensils, water: Waves,
    other: Folder, unassigned: CircleHelp,
};

export const ROW_EMBLEM_OPTIONS = ROW_ICON_CATALOGUE.map(option => ({ ...option, icon: ICON_COMPONENTS[option.value] }));

function automaticIcon(code: string): LucideIcon {
    return ICON_COMPONENTS[rowIconForClass(assetClassColourKey(code))];
}

export function PositionRowEmblem({ code, emblem, className, expanded = true }: { code: string; emblem: RowEmblem; className?: string; expanded?: boolean }) {
    if (emblem === 'none') return <Triangle className={className} size={10} fill="currentColor" strokeWidth={0}
        data-row-disclosure={expanded ? 'down' : 'right'} style={{ transform: `rotate(${expanded ? 180 : 90}deg)` }} aria-hidden="true" />;
    const Icon = emblem === 'auto' ? automaticIcon(code) : ICON_COMPONENTS[emblem];
    return <Icon className={className} size={16} strokeWidth={1.8} aria-hidden="true" />;
}
