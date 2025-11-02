export interface IParentCategory {
  label: string;
  children: IChildCategory[];
}

export interface IChildCategory {
  label: string;
  values: { time: string; value: number }[];
}
