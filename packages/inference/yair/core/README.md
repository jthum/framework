# YAIR

Yet Another Inference Runtime is a small, provider-neutral inference and tool loop. It implements
Framework's `InferenceRuntime` contract and resolves tools again before every model step.

Provider packages implement YAIR's narrower `ModelProvider` contract. YAIR remains a separate
workspace package even while it is developed in the Framework repository.
