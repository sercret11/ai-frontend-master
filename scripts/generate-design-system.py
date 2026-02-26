#!/usr/bin/env python3
"""
Design System Generator Script

Generates design tokens and configurations from assets/ directory:
- Loads color, font, and style data
- Recommends design styles based on product type
- Generates CSS variables
- Generates Tailwind config
- Generates shadcn/ui theme config

Usage:
    python scripts/generate-design-system.py [--product-type TYPE] [--output DIR]

Examples:
    python scripts/generate-design-system.py
    python scripts/generate-design-system.py --product-type ecommerce --output ./design-system
"""

import json
import os
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class ColorToken:
    """Color token definition"""
    name: str
    value: str
    type: str  # primary, secondary, accent, neutral, semantic
    variants: Dict[str, str]  # 50, 100, 200, ... 950


@dataclass
class FontToken:
    """Font token definition"""
    name: str
    family: str
    weights: List[int]
    sizes: Dict[str, str]  # xs, sm, base, lg, xl, etc.
    line_heights: Dict[str, str]


@dataclass
class SpacingToken:
    """Spacing token definition"""
    scale_factor: float
    values: Dict[str, str]


@dataclass
class DesignSystem:
    """Complete design system"""
    colors: List[ColorToken]
    fonts: List[FontToken]
    spacing: SpacingToken
    radius: Dict[str, str]
    shadows: Dict[str, str]
    breakpoints: Dict[str, str]


# Predefined design style recommendations
DESIGN_STYLES = {
    "ecommerce": {
        "description": "Modern e-commerce with clean aesthetics",
        "primary_color": "blue",
        "accent_color": "orange",
        "border_radius": "rounded",
        "typography": "sans",
        "spacing": "comfortable",
        "shadows": "subtle"
    },
    "saas": {
        "description": "Professional SaaS with trust-building design",
        "primary_color": "indigo",
        "accent_color": "purple",
        "border_radius": "medium",
        "typography": "sans",
        "spacing": "comfortable",
        "shadows": "soft"
    },
    "social": {
        "description": "Vibrant social platform with engaging UI",
        "primary_color": "pink",
        "accent_color": "purple",
        "border_radius": "full",
        "typography": "sans",
        "spacing": "compact",
        "shadows": "colorful"
    },
    "finance": {
        "description": "Trustworthy finance with conservative design",
        "primary_color": "slate",
        "accent_color": "emerald",
        "border_radius": "subtle",
        "typography": "sans",
        "spacing": "spacious",
        "shadows": "minimal"
    },
    "healthcare": {
        "description": "Clean healthcare design with calming colors",
        "primary_color": "teal",
        "accent_color": "cyan",
        "border_radius": "medium",
        "typography": "sans",
        "spacing": "comfortable",
        "shadows": "soft"
    },
    "education": {
        "description": "Friendly education platform with playful elements",
        "primary_color": "yellow",
        "accent_color": "blue",
        "border_radius": "rounded",
        "typography": "friendly",
        "spacing": "comfortable",
        "shadows": "playful"
    }
}

# Color palettes (Tailwind-inspired)
COLOR_PALETTES = {
    "slate": {
        "50": "#f8fafc", "100": "#f1f5f9", "200": "#e2e8f0", "300": "#cbd5e1",
        "400": "#94a3b8", "500": "#64748b", "600": "#475569", "700": "#334155",
        "800": "#1e293b", "900": "#0f172a", "950": "#020617"
    },
    "gray": {
        "50": "#f9fafb", "100": "#f3f4f6", "200": "#e5e7eb", "300": "#d1d5db",
        "400": "#9ca3af", "500": "#6b7280", "600": "#4b5563", "700": "#374151",
        "800": "#1f2937", "900": "#111827", "950": "#030712"
    },
    "blue": {
        "50": "#eff6ff", "100": "#dbeafe", "200": "#bfdbfe", "300": "#93c5fd",
        "400": "#60a5fa", "500": "#3b82f6", "600": "#2563eb", "700": "#1d4ed8",
        "800": "#1e40af", "900": "#1e3a8a", "950": "#172554"
    },
    "indigo": {
        "50": "#eef2ff", "100": "#e0e7ff", "200": "#c7d2fe", "300": "#a5b4fc",
        "400": "#818cf8", "500": "#6366f1", "600": "#4f46e5", "700": "#4338ca",
        "800": "#3730a3", "900": "#312e81", "950": "#1e1b4b"
    },
    "purple": {
        "50": "#faf5ff", "100": "#f3e8ff", "200": "#e9d5ff", "300": "#d8b4fe",
        "400": "#c084fc", "500": "#a855f7", "600": "#9333ea", "700": "#7e22ce",
        "800": "#6b21a8", "900": "#581c87", "950": "#3b0764"
    },
    "pink": {
        "50": "#fdf2f8", "100": "#fce7f3", "200": "#fbcfe8", "300": "#f9a8d4",
        "400": "#f472b6", "500": "#ec4899", "600": "#db2777", "700": "#be185d",
        "800": "#9d174d", "900": "#831843", "950": "#500724"
    },
    "red": {
        "50": "#fef2f2", "100": "#fee2e2", "200": "#fecaca", "300": "#fca5a5",
        "400": "#f87171", "500": "#ef4444", "600": "#dc2626", "700": "#b91c1c",
        "800": "#991b1b", "900": "#7f1d1d", "950": "#450a0a"
    },
    "orange": {
        "50": "#fff7ed", "100": "#ffedd5", "200": "#fed7aa", "300": "#fdba74",
        "400": "#fb923c", "500": "#f97316", "600": "#ea580c", "700": "#c2410c",
        "800": "#9a3412", "900": "#7c2d12", "950": "#431407"
    },
    "yellow": {
        "50": "#fefce8", "100": "#fef9c3", "200": "#fef08a", "300": "#fde047",
        "400": "#facc15", "500": "#eab308", "600": "#ca8a04", "700": "#a16207",
        "800": "#854d0e", "900": "#713f12", "950": "#422006"
    },
    "green": {
        "50": "#f0fdf4", "100": "#dcfce7", "200": "#bbf7d0", "300": "#86efac",
        "400": "#4ade80", "500": "#22c55e", "600": "#16a34a", "700": "#15803d",
        "800": "#166534", "900": "#14532d", "950": "#052e16"
    },
    "emerald": {
        "50": "#ecfdf5", "100": "#d1fae5", "200": "#a7f3d0", "300": "#6ee7b7",
        "400": "#34d399", "500": "#10b981", "600": "#059669", "700": "#047857",
        "800": "#065f46", "900": "#064e3b", "950": "#022c22"
    },
    "teal": {
        "50": "#f0fdfa", "100": "#ccfbf1", "200": "#99f6e4", "300": "#5eead4",
        "400": "#2dd4bf", "500": "#14b8a6", "600": "#0d9488", "700": "#0f766e",
        "800": "#115e59", "900": "#134e4a", "950": "#042f2e"
    },
    "cyan": {
        "50": "#ecfeff", "100": "#cffafe", "200": "#a5f3fc", "300": "#67e8f9",
        "400": "#22d3ee", "500": "#06b6d4", "600": "#0891b2", "700": "#0e7490",
        "800": "#155e75", "900": "#164e63", "950": "#083344"
    }
}

# Border radius scales
BORDER_RADIUS = {
    "none": {"none": "0px"},
    "subtle": {"sm": "0.125rem", "DEFAULT": "0.25rem", "md": "0.375rem", "lg": "0.5rem", "xl": "0.75rem"},
    "rounded": {"sm": "0.125rem", "DEFAULT": "0.375rem", "md": "0.5rem", "lg": "0.75rem", "xl": "1rem", "2xl": "1.5rem"},
    "medium": {"sm": "0.25rem", "DEFAULT": "0.5rem", "md": "0.75rem", "lg": "1rem", "xl": "1.5rem", "2xl": "2rem"},
    "full": {"sm": "9999px", "DEFAULT": "9999px", "md": "9999px", "lg": "9999px", "xl": "9999px", "full": "9999px"}
}

# Shadow scales
SHADOWS = {
    "minimal": {
        "xs": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "sm": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)"
    },
    "subtle": {
        "DEFAULT": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"
    },
    "soft": {
        "DEFAULT": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        "md": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        "lg": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)"
    },
    "colorful": {
        "DEFAULT": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        "lg": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
        "color": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)"
    },
    "playful": {
        "DEFAULT": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        "lg": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
        "xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)"
    }
}

# Typography scales
TYPOGRAPHY = {
    "sans": {
        "family": ["Inter", "system-ui", "sans-serif"],
        "sizes": {
            "xs": ["0.75rem", "1rem"],
            "sm": ["0.875rem", "1.25rem"],
            "base": ["1rem", "1.5rem"],
            "lg": ["1.125rem", "1.75rem"],
            "xl": ["1.25rem", "1.75rem"],
            "2xl": ["1.5rem", "2rem"],
            "3xl": ["1.875rem", "2.25rem"],
            "4xl": ["2.25rem", "2.5rem"]
        }
    },
    "friendly": {
        "family": ["Nunito", "system-ui", "sans-serif"],
        "sizes": {
            "xs": ["0.75rem", "1rem"],
            "sm": ["0.875rem", "1.25rem"],
            "base": ["1rem", "1.5rem"],
            "lg": ["1.125rem", "1.75rem"],
            "xl": ["1.25rem", "1.75rem"],
            "2xl": ["1.5rem", "2rem"],
            "3xl": ["1.875rem", "2.25rem"],
            "4xl": ["2.25rem", "2.5rem"]
        }
    }
}

# Spacing scales
SPACING = {
    "compact": {"scale": 0.25, "base": "0.25rem"},
    "comfortable": {"scale": 0.5, "base": "0.5rem"},
    "spacious": {"scale": 1, "base": "1rem"}
}


def load_assets(assets_dir: str) -> Dict[str, Any]:
    """Load design assets from assets/ directory"""
    assets = {
        "colors": {},
        "fonts": {},
        "styles": {}
    }

    assets_path = Path(assets_dir)
    if not assets_path.exists():
        print(f"⚠️  Assets directory not found: {assets_dir}")
        print("   Using default design tokens instead")
        return assets

    # Load colors
    colors_file = assets_path / "colors.json"
    if colors_file.exists():
        try:
            with open(colors_file, 'r') as f:
                assets["colors"] = json.load(f)
            print(f"✓ Loaded colors from {colors_file}")
        except Exception as e:
            print(f"✗ Failed to load colors: {e}")

    # Load fonts
    fonts_file = assets_path / "fonts.json"
    if fonts_file.exists():
        try:
            with open(fonts_file, 'r') as f:
                assets["fonts"] = json.load(f)
            print(f"✓ Loaded fonts from {fonts_file}")
        except Exception as e:
            print(f"✗ Failed to load fonts: {e}")

    # Load styles
    styles_file = assets_path / "styles.json"
    if styles_file.exists():
        try:
            with open(styles_file, 'r') as f:
                assets["styles"] = json.load(f)
            print(f"✓ Loaded styles from {styles_file}")
        except Exception as e:
            print(f"✗ Failed to load styles: {e}")

    return assets


def recommend_design_style(product_type: str, assets: Dict[str, Any]) -> Dict[str, Any]:
    """Recommend design style based on product type"""
    if product_type and product_type.lower() in DESIGN_STYLES:
        style = DESIGN_STYLES[product_type.lower()]
        print(f"\n✓ Using recommended style for '{product_type}': {style['description']}")
        return style

    print("\n✓ Using default design style")
    return DESIGN_STYLES["saas"]


def generate_design_system(style: Dict[str, Any], assets: Dict[str, Any]) -> DesignSystem:
    """Generate complete design system"""
    primary_color_name = style.get("primary_color", "indigo")
    accent_color_name = style.get("accent_color", "purple")
    radius_type = style.get("border_radius", "medium")
    shadow_type = style.get("shadows", "soft")
    typography_type = style.get("typography", "sans")
    spacing_type = style.get("spacing", "comfortable")

    # Generate color tokens
    colors = [
        ColorToken(
            name="primary",
            value=COLOR_PALETTES[primary_color_name]["500"],
            type="primary",
            variants=COLOR_PALETTES[primary_color_name]
        ),
        ColorToken(
            name="accent",
            value=COLOR_PALETTES[accent_color_name]["500"],
            type="accent",
            variants=COLOR_PALETTES[accent_color_name]
        ),
        ColorToken(
            name="neutral",
            value=COLOR_PALETTES["slate"]["500"],
            type="neutral",
            variants=COLOR_PALETTES["slate"]
        ),
        ColorToken(
            name="success",
            value=COLOR_PALETTES["emerald"]["500"],
            type="semantic",
            variants=COLOR_PALETTES["emerald"]
        ),
        ColorToken(
            name="warning",
            value=COLOR_PALETTES["yellow"]["500"],
            type="semantic",
            variants=COLOR_PALETTES["yellow"]
        ),
        ColorToken(
            name="error",
            value=COLOR_PALETTES["red"]["500"],
            type="semantic",
            variants=COLOR_PALETTES["red"]
        )
    ]

    # Generate font tokens
    typography = TYPOGRAPHY[typography_type]
    fonts = [
        FontToken(
            name="sans",
            family=typography["family"][0],
            weights=[300, 400, 500, 600, 700],
            sizes=typography["sizes"],
            line_heights={
                "tight": "1.25",
                "normal": "1.5",
                "relaxed": "1.75"
            }
        )
    ]

    # Generate spacing tokens
    spacing_config = SPACING[spacing_type]
    spacing = SpacingToken(
        scale_factor=spacing_config["scale"],
        values={
            "0": "0",
            "px": "1px",
            "0.5": spacing_config["base"],
            "1": f"{spacing_config['scale']}rem",
            "2": f"{spacing_config['scale'] * 2}rem",
            "3": f"{spacing_config['scale'] * 3}rem",
            "4": f"{spacing_config['scale'] * 4}rem",
            "5": f"{spacing_config['scale'] * 5}rem",
            "6": f"{spacing_config['scale'] * 6}rem",
            "8": f"{spacing_config['scale'] * 8}rem",
            "10": f"{spacing_config['scale'] * 10}rem",
            "12": f"{spacing_config['scale'] * 12}rem",
            "16": f"{spacing_config['scale'] * 16}rem",
            "20": f"{spacing_config['scale'] * 20}rem",
            "24": f"{spacing_config['scale'] * 24}rem"
        }
    )

    # Generate radius tokens
    radius = BORDER_RADIUS[radius_type]

    # Generate shadow tokens
    shadows = SHADOWS[shadow_type]

    # Generate breakpoints
    breakpoints = {
        "sm": "640px",
        "md": "768px",
        "lg": "1024px",
        "xl": "1280px",
        "2xl": "1536px"
    }

    return DesignSystem(
        colors=colors,
        fonts=fonts,
        spacing=spacing,
        radius=radius,
        shadows=shadows,
        breakpoints=breakpoints
    )


def generate_css_variables(design_system: DesignSystem) -> str:
    """Generate CSS variables file"""
    css = [":root {\n"]

    # Color variables
    for color in design_system.colors:
        css.append(f"  /* {color.name.upper()} */\n")
        for shade, value in color.variants.items():
            css.append(f"  --color-{color.name}-{shade}: {value};\n")
        css.append("\n")

    # Spacing variables
    css.append("  /* SPACING */\n")
    for key, value in design_system.spacing.values.items():
        css.append(f"  --spacing-{key}: {value};\n")
    css.append("\n")

    # Radius variables
    css.append("  /* BORDER RADIUS */\n")
    for key, value in design_system.radius.items():
        css.append(f"  --radius-{key}: {value};\n")
    css.append("\n")

    # Shadow variables
    css.append("  /* SHADOWS */\n")
    for key, value in design_system.shadows.items():
        css.append(f"  --shadow-{key}: {value};\n")
    css.append("\n")

    # Breakpoint variables
    css.append("  /* BREAKPOINTS */\n")
    for key, value in design_system.breakpoints.items():
        css.append(f"  --breakpoint-{key}: {value};\n")

    css.append("}\n")

    return "".join(css)


def generate_tailwind_config(design_system: DesignSystem) -> Dict[str, Any]:
    """Generate Tailwind CSS configuration"""
    colors = {}
    for color in design_system.colors:
        colors[color.name] = color.variants

    config = {
        "theme": {
            "extend": {
                "colors": colors,
                "spacing": design_system.spacing.values,
                "borderRadius": design_system.radius,
                "boxShadow": design_system.shadows,
                "screens": design_system.breakpoints,
                "fontFamily": {
                    font.name: font.family for font in design_system.fonts
                },
                "fontSize": design_system.fonts[0].sizes
            }
        }
    }

    return config


def generate_shadcn_theme(design_system: DesignSystem) -> Dict[str, Any]:
    """Generate shadcn/ui theme configuration"""
    primary = next(c for c in design_system.colors if c.name == "primary")
    accent = next(c for c in design_system.colors if c.name == "accent")
    neutral = next(c for c in design_system.colors if c.name == "neutral")

    theme = {
        "name": "default",
        "type": "light",
        "colors": {
            "background": neutral.variants["50"],
            "foreground": neutral.variants["950"],
            "card": neutral.variants["50"],
            "cardForeground": neutral.variants["950"],
            "popover": neutral.variants["50"],
            "popoverForeground": neutral.variants["950"],
            "primary": primary.variants["500"],
            "primaryForeground": neutral.variants["50"],
            "secondary": neutral.variants["100"],
            "secondaryForeground": neutral.variants["900"],
            "muted": neutral.variants["100"],
            "mutedForeground": neutral.variants["500"],
            "accent": accent.variants["500"],
            "accentForeground": neutral.variants["50"],
            "destructive": design_system.colors[4].variants["500"],
            "destructiveForeground": neutral.variants["50"],
            "border": neutral.variants["200"],
            "input": neutral.variants["200"],
            "ring": primary.variants["500"]
        },
        "borderRadius": design_system.radius.get("DEFAULT", "0.5rem")
    }

    return theme


def save_outputs(design_system: DesignSystem, output_dir: str):
    """Save all generated files to output directory"""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Save CSS variables
    css_file = output_path / "design-tokens.css"
    with open(css_file, 'w') as f:
        f.write("/* Design System CSS Variables */\n")
        f.write("/* Generated by generate-design-system.py */\n\n")
        f.write(generate_css_variables(design_system))
    print(f"✓ Generated CSS variables: {css_file}")

    # Save Tailwind config
    tailwind_file = output_path / "tailwind.config.json"
    with open(tailwind_file, 'w') as f:
        json.dump(generate_tailwind_config(design_system), f, indent=2)
    print(f"✓ Generated Tailwind config: {tailwind_file}")

    # Save shadcn/ui theme
    shadcn_file = output_path / "shadcn-theme.json"
    with open(shadcn_file, 'w') as f:
        json.dump(generate_shadcn_theme(design_system), f, indent=2)
    print(f"✓ Generated shadcn/ui theme: {shadcn_file}")

    # Save complete design system JSON
    system_file = output_path / "design-system.json"
    with open(system_file, 'w') as f:
        json.dump(asdict(design_system), f, indent=2, default=str)
    print(f"✓ Generated design system: {system_file}")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Generate design system from assets"
    )
    parser.add_argument(
        "--product-type",
        type=str,
        choices=list(DESIGN_STYLES.keys()),
        help="Product type for style recommendations"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="./design-system",
        help="Output directory for generated files"
    )
    parser.add_argument(
        "--assets",
        type=str,
        default="./assets",
        help="Assets directory containing colors, fonts, styles"
    )

    args = parser.parse_args()

    print("=" * 60)
    print("🎨 DESIGN SYSTEM GENERATOR")
    print("=" * 60)

    # Load assets
    print("\n📂 Loading assets...")
    assets = load_assets(args.assets)

    # Recommend design style
    print("\n💡 Recommending design style...")
    style = recommend_design_style(args.product_type, assets)

    # Generate design system
    print("\n🔧 Generating design system...")
    design_system = generate_design_system(style, assets)

    # Save outputs
    print(f"\n💾 Saving outputs to: {args.output}")
    save_outputs(design_system, args.output)

    print("\n" + "=" * 60)
    print("✅ Design system generation complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
