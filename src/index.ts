import { ReplicatedStorage, RunService } from "@rbxts/services";
import { TimerInstance } from "@rbxts/simpletimer";
import simpleTimer from "@rbxts/simpletimer";
import Object from "@rbxts/object-utils";

const STATUS_FOLDER_NAME = "StatusEffects";
const STACK_KEY = "stacks";

export type StatusType = {
	Name: string;
	Duration: number;
	Tick: number;
	Effect: (model: Model) => void;
	Completion: (model: Model) => void;
	Stacks?: boolean;
	MaxStacks?: number;
	StatusAttributes?: string[];
	Modifiers?: Map<string, string>;
};

class SimpleStatusEffect {
	private statusEffects: Map<string, StatusType> = new Map();
	private appliedStatuses: Map<Model, { [key: string]: TimerInstance }> = new Map();

	constructor() {
		this.loadStatusEffects();
	}

	private loadStatusEffects() {
		const statusFolder = ReplicatedStorage.FindFirstChild(STATUS_FOLDER_NAME, true);
		if (!statusFolder) {
			error(`No folder named "${STATUS_FOLDER_NAME}" found in replicated storage.`);
		}

		for (const child of statusFolder.GetDescendants()) {
			if (child.IsA("ModuleScript")) {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const status = require(child) as StatusType;

				this.createStatusEffect(status);
			}
		}
	}

	public createStatusEffect(statusData: StatusType) {
		if (!RunService.IsServer()) error("Must be called from the server.");
		if (this.statusEffects.has(statusData.Name.lower())) {
			error(`Skill with name "${statusData.Name}" already exists.`);
		}

		if (statusData.StatusAttributes) {
			const lowerCase: string[] = [];
			statusData.StatusAttributes?.forEach((v) => {
				lowerCase.push(v.lower());
			});
			statusData.StatusAttributes = lowerCase;
		}

		if (statusData.Modifiers) {
			const lowerCase = new Map<string, string>();
			statusData.Modifiers?.forEach((v, k) => {
				lowerCase.set(k.lower(), v);
			});
			statusData.Modifiers = lowerCase;
		}

		this.statusEffects.set(statusData.Name.lower(), statusData);

		return;
	}

	public applyStatusEffect(model: Model, statusName: string) {
		if (!RunService.IsServer()) error("Must be called from the server.");

		// Verify status effect
		const status = this.statusEffects.get(statusName.lower());
		if (!status) {
			error(`No status with name "${statusName}" found.`);
		}

		// Add stack attribute
		const stackKey = status.Name.lower() + "_" + STACK_KEY;
		if (status.Stacks) {
			if (!status.MaxStacks) error("Status is stackable but has no max stacks.");
			const existingStacks = model.GetAttribute(stackKey) as number;
			if (existingStacks) {
				if (existingStacks < status.MaxStacks) {
					model.SetAttribute(stackKey, existingStacks + 1);
				} else {
					return;
				}
			} else {
				model.SetAttribute(stackKey, 1);
			}
		}

		// Timer
		const task = simpleTimer.CreateTimer({
			Name: status.Stacks
				? status.Name.lower() + tostring(model.GetAttribute(stackKey) as number)
				: status.Name.lower(),
			Duration: status.Duration,
			Tick: status.Tick,
			AutoDestroy: true,
		});

		// On Tick
		task.onTick.Event.Connect(() => {
			status.Effect(model);
		});

		// On Completed
		task.completed.Event.Connect(() => {
			if (status.Stacks) {
				const existingStacks = model.GetAttribute(stackKey) as number;
				if (existingStacks) {
					model.SetAttribute(stackKey, existingStacks - 1);
					this.removeStatusEffect(model, status.Name.lower() + tostring(existingStacks - 1));

					if ((model.GetAttribute(stackKey) as number) === 0) {
						model.SetAttribute(status.Name.lower(), undefined);
						model.SetAttribute(stackKey, undefined);
						this.removeStatusEffect(model, status.Name.lower());
					}
				}
			} else {
				model.SetAttribute(status.Name.lower(), undefined);
				this.removeStatusEffect(model, status.Name.lower());
			}
		});

		// Combines with another status effect to create a new status effect
		if (status.Modifiers) {
			const modifierConn = model.AttributeChanged.Connect((attribute) => {
				const modifier = status.Modifiers?.get(attribute);
				if (modifier) {
					const modifierStatus = this.getStatusEffect(modifier.lower());
					if (modifierStatus && !model.GetAttribute(modifierStatus.Name.lower())) {
						this.removeStatusEffect(model, attribute.lower());
						this.removeStatusEffect(model, status.Name.lower());
						this.applyStatusEffect(model, modifierStatus.Name.lower());

						task.Stop();
						modifierConn.Disconnect();
					}
				}
			});

			task.completed.Event.Once(() => modifierConn.Disconnect());
		}

		task.Start();
		model.SetAttribute(status.Name.lower(), true);

		const existingStatuses = this.appliedStatuses.get(model) || {};
		existingStatuses[
			status.Stacks ? status.Name.lower() + tostring(model.GetAttribute(stackKey) as number) : status.Name.lower()
		] = task;
		this.appliedStatuses.set(model, existingStatuses);
	}

	public removeStatusEffect(model: Model, statusName: string) {
		if (!RunService.IsServer()) error("Must be called from the server.");

		const foundStatuses = this.appliedStatuses.get(model);
		const status = this.statusEffects.get(statusName);
		if (foundStatuses && status) {
			const stackKey = status.Name.lower() + "_" + STACK_KEY;
			if (status.Stacks) {
				if ((model.GetAttribute(stackKey) as number) === 0) {
					for (const [, timer] of Object.entries(foundStatuses)) {
						timer.Stop();
						delete foundStatuses[timer.Name.lower()];
					}

					model.SetAttribute(statusName.lower(), undefined);
				}
			}

			const timerInstance = foundStatuses[statusName.lower()];
			if (timerInstance) {
				timerInstance.Stop();
				delete foundStatuses[statusName.lower()];
				model.SetAttribute(statusName.lower(), undefined);
				status.Completion(model);
			}
			status.Completion(model);
		}
	}

	public getStatusEffect(statusEffect: string): StatusType | undefined {
		if (!RunService.IsServer()) error("Must be called from the server.");

		return this.statusEffects.get(statusEffect.lower());
	}
}

const simpleStatusEffect = new SimpleStatusEffect();
export default simpleStatusEffect;
