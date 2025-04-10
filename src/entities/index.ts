import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity()
export class Account {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column('text')
    username!: string;

    @Column('text', { nullable: true})
    password!: string;

    @Column('text', { nullable: true})
    cookies!: string;

    @Column('boolean', { default: true })
    isActive!: boolean;

    @CreateDateColumn({
        transformer: {
            from: (date: Date) => date && new Date(date.getTime() + (8 * 60 * 60 * 1000)),
            to: (date: Date) => date
        }
    })
    createdAt!: Date;

    @UpdateDateColumn({
        transformer: {
            from: (date: Date) => date && new Date(date.getTime() + (8 * 60 * 60 * 1000)),
            to: (date: Date) => date
        }
    })
    updatedAt!: Date;

    @Column('boolean', { nullable: true, default: false })
    clearRecycle!: boolean;

    @Column('text', { nullable: true })
    localStrmPrefix!: string;
    @Column('text', { nullable: true })
    cloudStrmPrefix!: string;
}

@Entity()
export class Task {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column('integer')
    accountId!: number;

    @ManyToOne(() => Account, { nullable: true })
    @JoinColumn({ name: 'accountId' })
    account!: Account;

    @Column('text')
    shareLink!: string;

    @Column('text')
    targetFolderId!: string;

    @Column('text', { nullable: true })
    videoType!: string;

    @Column('text', { default: 'pending' })
    status!: string;

    @Column('text', { nullable: true })
    lastError!: string;

    @Column('datetime', { nullable: true, transformer: {
        from: (date: Date) => date && new Date(date.getTime() + (8 * 60 * 60 * 1000)),
        to: (date: Date) => date
    } })
    lastCheckTime!: Date;

    @Column('datetime', { nullable: true})
    lastFileUpdateTime!: Date;

    @Column('text', { nullable: true })
    resourceName!: string;

    @Column('integer', { default: 0 })
    totalEpisodes!: number;

    @Column('integer', { default: 0 })
    currentEpisodes!: number;

    @Column('text', { nullable: true })
    realFolderId!: string;

    @Column('text', { nullable: true })
    realFolderName!: string;

    @Column('text', { nullable: true })
    shareFileId!: string;

    @Column('text', { nullable: true })
    shareFolderId!: string;

    @Column('text', { nullable: true })
    shareFolderName!: string;

    @Column('text', { nullable: true })
    shareId!: string;
    
    @Column('text', { nullable: true })
    shareMode!: string;

    @Column('text', { nullable: true })
    pathType!: string;

    @CreateDateColumn({
        transformer: {
            from: (date: Date) => date && new Date(date.getTime() + (8 * 60 * 60 * 1000)),
            to: (date: Date) => date
        }
    })
    createdAt!: Date;

    @UpdateDateColumn({
        transformer: {
            from: (date: Date) => date && new Date(date.getTime() + (8 * 60 * 60 * 1000)),
            to: (date: Date) => date
        }
    })
    updatedAt!: Date;

    @Column('text', { nullable: true })
    accessCode!: string;

    @Column('text', { nullable: true })
    sourceRegex!: string;
    
    @Column('text', { nullable: true })
    targetRegex!: string;

    @Column('text', { nullable: true })
    matchPattern!: string;
    @Column('text', { nullable: true })
    matchOperator!: string;
    @Column('text', { nullable: true })
    matchValue!: string;

    @Column('integer', { nullable: true })
    retryCount!: number;
    @Column('datetime', { nullable: true, transformer: {
        from: (date: Date) => date && new Date(date.getTime() + (8 * 60 * 60 * 1000)),
        to: (date: Date) => date
    } })
    nextRetryTime!: Date;

    @Column('text', { nullable: true })
    remark!: string;

    @Column({ nullable: true })
    cronExpression!: string;

    @Column({ default: false })
    enableCron!: boolean;

    @Column({ nullable: true })
    realRootFolderId!: string;

    @Column({ nullable: true })
    embyId!: string;
}

export default { Account, Task };