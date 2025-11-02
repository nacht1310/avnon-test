import { JsonPipe } from '@angular/common';
import { Component, computed, OnDestroy, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  UntypedFormArray,
  UntypedFormGroup,
} from '@angular/forms';
import { DateTime } from 'luxon';
import { debounceTime, map, Subject, takeUntil, tap } from 'rxjs';
import { IParentCategory, IChildCategory } from './app.types';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule, MatIconModule, MatButtonModule],
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  // Unsubscribe from all subscriptions
  private _unsubscribeAll = new Subject<void>();

  // Form Range to create table columns
  rangeForm!: UntypedFormGroup;
  ranges!: Signal<Array<string>>;
  defaultRanges = {
    start: '2024-01',
    end: '2024-12',
  };

  // Set up signals to hold income and expense values
  incomeParentForm!: UntypedFormArray;
  expenseParentForm!: UntypedFormArray;

  incomeChildren!: Signal<Array<{ label: string; value: number; parent: string; time: string }>>;
  expenseChildren!: Signal<Array<{ label: string; value: number; parent: string; time: string }>>;

  subTotalIncome = computed(() => {
    if (!this.incomeChildren()) {
      return [];
    }

    const data: Array<{ parent: string; range: string; total: number }> = [];
    const incomeParents = this.incomeParentForm.value.map((item: any) => item.label);
    for (const range of this.ranges()) {
      for (const parent of incomeParents) {
        const children = this.incomeChildren().filter(
          (item) => item.parent === parent && item.time === range
        );
        const total = children.reduce((a, b) => a + Number(b.value), 0) || 0;
        data.push({ parent, range, total });
      }
    }
    return data;
  });

  subTotalExpense = computed(() => {
    if (!this.expenseChildren()) {
      return [];
    }

    const data: Array<{ parent: string; range: string; total: number }> = [];
    const expenseParents = this.expenseParentForm.value.map((item: any) => item.label);
    for (const range of this.ranges()) {
      for (const parent of expenseParents) {
        const children = this.expenseChildren().filter(
          (item) => item.parent === parent && item.time === range
        );
        const total = children.reduce((a, b) => a + Number(b.value), 0) || 0;
        data.push({ parent, range, total });
      }
    }
    return data;
  });

  // Computed signals to calculate totals and profit/loss
  totalExpenseValue = computed<Map<string, number>>(() => {
    const data = new Map<string, number>();

    for (const range of this.ranges()) {
      const expense = this.subTotalExpense().filter((item) => item.range === range);

      data.set(range, expense.reduce((a, b) => a + Number(b.total), 0) || 0);
    }

    return data;
  });

  totalIncomeValue = computed(() => {
    const data = new Map<string, number>();
    for (const range of this.ranges()) {
      const income = this.subTotalIncome().filter((item) => item.range === range);
      data.set(range, income.reduce((a, b) => a + Number(b.total), 0) || 0);
    }

    return data;
  });

  profitLossValue = computed(() => {
    const income = this.totalIncomeValue();
    const expense = this.totalExpenseValue();

    const result = new Map<string, number>();
    for (const range of this.ranges()) {
      const incomeValue = income.get(range) || 0;
      const expenseValue = expense.get(range) || 0;
      result.set(range, incomeValue - expenseValue);
    }

    return result;
  });

  // Computed signal to determine opening and closing balance
  openCloseBalance = computed(() => {
    const data = new Map();
    for (const [index, range] of this.ranges().entries()) {
      // Logic to calculate opening balance can be added here
      const profitLoss = this.profitLossValue().get(range) || 0;
      if (index === 0) {
        const opening = 0;
        data.set(range, { opening, closing: opening + profitLoss });
      } else {
        const opening = data.get(this.ranges()[index - 1]).closing || 0;
        data.set(range, { opening, closing: opening + profitLoss });
      }
    }
    return data;
  });

  // Lifecycle hook
  constructor(private _formBuilder: FormBuilder) {
    this.rangeForm = this._formBuilder.group({
      start: [this.defaultRanges.start],
      end: [this.defaultRanges.end],
    });

    this.incomeParentForm = this._formBuilder.array([]);
    this.expenseParentForm = this._formBuilder.array([]);

    // Subscribe to form value changes
    this.ranges = toSignal(
      this.rangeForm.valueChanges.pipe(
        takeUntil(this._unsubscribeAll),
        map(({ start, end }: { start: string; end: string }) => {
          const ranges = this.getRangeValues({ start, end });

          // Update child entries for both income and expense forms
          this.updateChildrenForNewRanges();

          return ranges;
        })
      ),
      {
        initialValue: this.getRangeValues(this.defaultRanges),
      }
    );

    this.incomeChildren = toSignal(
      this.incomeParentForm.valueChanges.pipe(
        takeUntil(this._unsubscribeAll),
        debounceTime(200),
        map((values) => {
          return values.flatMap((item: IParentCategory) => {
            const label = item.label;
            return item.children.flatMap((child: IChildCategory) => {
              const childLabel = child.label;
              return child.values.map((valueItem: any) => ({
                label: childLabel,
                value: valueItem.value,
                parent: label,
                time: valueItem.time,
              }));
            });
          });
        })
      )
    );

    this.expenseChildren = toSignal(
      this.expenseParentForm.valueChanges.pipe(
        takeUntil(this._unsubscribeAll),
        debounceTime(200),
        map((values) => {
          return values.flatMap((item: IParentCategory) => {
            const label = item.label;
            return item.children.flatMap((child: IChildCategory) => {
              const childLabel = child.label;
              return child.values.map((valueItem: any) => ({
                label: childLabel,
                value: valueItem.value,
                parent: label,
                time: valueItem.time,
              }));
            });
          });
        })
      )
    );

    // Initialize with one parent category each
    this.addIncomeParent('Incomes');
    this.addExpenseParent('Expenses');
  }

  ngOnDestroy(): void {
    this._unsubscribeAll.next();
    this._unsubscribeAll.complete();
  }

  // Function to generate range values between start and end dates
  getRangeValues({ start, end }: { start: string; end: string }): Array<string> {
    const startValue = DateTime.fromFormat(start, 'yyyy-MM');
    const endValue = DateTime.fromFormat(end, 'yyyy-MM');
    const diff = endValue.diff(startValue, 'months').months;

    const ranges: Array<string> = [];
    for (let i = 0; i <= diff; i++) {
      ranges.push(startValue.plus({ months: i }).toFormat('yyyy-MM'));
    }

    return ranges;
  }

  // Functions to add new income and expense parent categories
  addIncomeParent(parent?: string) {
    this.incomeParentForm.push(
      this._formBuilder.group({ label: [parent], children: this._formBuilder.array([]) })
    );
  }

  addExpenseParent(parent?: string) {
    this.expenseParentForm.push(
      this._formBuilder.group({ label: [parent], children: this._formBuilder.array([]) })
    );
  }

  // Functions to add new income and expense child entries
  addIncomeChild(parent?: string, range?: string) {
    const ranges = range ? [range] : this.ranges();
    const parents = parent ? [parent] : this.incomeParentForm.value.map((item: any) => item.label);
    for (const parentLabel of parents) {
      const parentForm = this.incomeParentForm.controls.find(
        (item) => item.value.label === parentLabel
      );
      if (parentForm) {
        const childrenArray = parentForm.get('children') as UntypedFormArray;
        const group = this._formBuilder.group({ label: [''], values: this._formBuilder.array([]) });
        for (const value of ranges) {
          const valuesArray = group.get('values') as UntypedFormArray;
          valuesArray.push(this._formBuilder.group({ value: [0], time: [value] }));
        }
        childrenArray.push(group);
      }
    }
  }

  addExpenseChild(parent?: string, range?: string) {
    const ranges = range ? [range] : this.ranges();
    const parents = parent ? [parent] : this.incomeParentForm.value.map((item: any) => item.label);
    for (const parentLabel of parents) {
      const parentForm = this.expenseParentForm.controls.find(
        (item) => item.value.label === parentLabel
      );
      if (parentForm) {
        const childrenArray = parentForm.get('children') as UntypedFormArray;
        const group = this._formBuilder.group({ label: [''], values: this._formBuilder.array([]) });
        for (const value of ranges) {
          const valuesArray = group.get('values') as UntypedFormArray;
          valuesArray.push(this._formBuilder.group({ value: [0], time: [value] }));
        }
        childrenArray.push(group);
      }
    }
  }

  // Functions to remove income and expense parent categories
  removeIncomeParent(index: number) {
    this.incomeParentForm.removeAt(index);
  }

  removeExpenseParent(index: number) {
    this.expenseParentForm.removeAt(index);
  }

  // Functions to remove income and expense child categories
  removeIncomeChild(parent: string, index: number) {
    const parentForm = this.incomeParentForm.controls.find((item) => item.value.label === parent);
    if (parentForm) {
      const childrenArray = parentForm.get('children') as UntypedFormArray;
      childrenArray.removeAt(index);
    }
  }

  removeExpenseChild(parent: string, index: number) {
    const parentForm = this.expenseParentForm.controls.find((item) => item.value.label === parent);
    if (parentForm) {
      const childrenArray = parentForm.get('children') as UntypedFormArray;
      childrenArray.removeAt(index);
    }
  }

  // Function to update the list of children when ranges change
  updateChildrenForNewRanges() {
    const ranges = this.ranges();
    // Update income children
    for (const parentControl of this.incomeParentForm.controls) {
      const childrenArray = parentControl.get('children') as UntypedFormArray;
      for (const childControl of childrenArray.controls) {
        const valuesArray = childControl.get('values') as UntypedFormArray;
        const existingTimes = valuesArray.value.map((item: any) => item.time);
        // Add new ranges
        for (const range of ranges) {
          if (!existingTimes.includes(range)) {
            valuesArray.push(this._formBuilder.group({ value: [0], time: [range] }));
          }
        }

        for (const range of existingTimes) {
          if (!ranges.includes(range)) {
            const index = valuesArray.value.findIndex((item: any) => item.time === range);
            if (index !== -1) {
              valuesArray.removeAt(index);
            }
          }
        }
      }
    }

    // Update expense children
    for (const parentControl of this.expenseParentForm.controls) {
      const childrenArray = parentControl.get('children') as UntypedFormArray;
      for (const childControl of childrenArray.controls) {
        const valuesArray = childControl.get('values') as UntypedFormArray;
        const existingTimes = valuesArray.value.map((item: any) => item.time);
        // Add new ranges
        for (const range of ranges) {
          if (!existingTimes.includes(range)) {
            valuesArray.push(this._formBuilder.group({ value: [0], time: [range] }));
          }
        }

        for (const range of existingTimes) {
          if (!ranges.includes(range)) {
            const index = valuesArray.value.findIndex((item: any) => item.time === range);
            if (index !== -1) {
              valuesArray.removeAt(index);
            }
          }
        }
      }
    }

    console.log(this.incomeParentForm.value);
    console.log(this.expenseParentForm.value);
  }

  // Map time to month year format
  mapTimeToMonthYear(time: string): string {
    return DateTime.fromFormat(time, 'yyyy-MM').toFormat('LLL yyyy');
  }

  getSubTotalIncomeForRange(range: string, parent: string): number {
    const children = this.subTotalIncome().find(
      (child) => child.range === range && child.parent === parent
    );
    return children?.total || 0;
  }

  getFormGroup(group: AbstractControl): UntypedFormGroup {
    return group as UntypedFormGroup;
  }

  getFormArray(group: AbstractControl): UntypedFormArray {
    return group as UntypedFormArray;
  }
}
