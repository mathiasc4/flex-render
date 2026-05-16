(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class ApplyFilterModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "apply-filter";
            }

            static name() {
                return "Apply layer filter";
            }

            static description() {
                return "Applies the owning ShaderLayer's configured scalar filter chain to a float value.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to filter."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Filtered scalar value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Apply scalar ShaderLayer filters.",
                    description: "Useful after raw numeric source-sampling modules when a modular graph should match legacy ShaderLayer sampling semantics.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value to filter." }
                    ],
                    outputs: [
                        { name: "value", type: "float", description: "Filtered scalar value." }
                    ]
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to filter."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Filtered scalar value."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const out = context.output("value", "float");
                const filtered = this.owner && typeof this.owner.filter === "function" ?
                    this.owner.filter(`(${value})`) : `(${value})`;

                return {
                    statements: `
float ${out} = ${filtered};
`,
                    outputs: {
                        value: { type: "float", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
